"""Семантический инференс: ONNX (rubert-tiny2) + kNN-max к эталонам категорий.

CPU-only, RAM ~150-250МБ, инференс ~1-5мс. Без torch в рантайме.
Модели нет или ошибка — predict возвращает ("NONE", 0.0), пайплайн идёт
по эвристическому fallback (ограничение зафиксировано в AGENTS.md).
"""
import os
import threading

try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None  # type: ignore

try:
    import onnxruntime as ort
except ImportError:  # pragma: no cover
    ort = None  # type: ignore

try:
    from transformers import AutoTokenizer
except ImportError:  # pragma: no cover
    AutoTokenizer = None  # type: ignore

from .prototypes import CATEGORIES, PROTOTYPES, SEMANTIC_MARGIN, SEMANTIC_THRESHOLD

MODEL_NAME = "rubert-tiny2-onnx"
MAX_LEN = 128


class SemanticModel:
    def __init__(self) -> None:
        self._sess = None
        self._tok = None
        self._proto_embs: dict[str, object] = {}
        self._lock = threading.Lock()
        self.loaded = False

    @property
    def available(self) -> bool:
        return self.loaded and self._sess is not None

    def load(self, model_dir: str) -> bool:
        """Загрузка ONNX + токенизатора. False — работаем без семантики."""
        if ort is None or AutoTokenizer is None or np is None:
            print("[SEMANTIC] onnxruntime/transformers/numpy не установлены — fallback без ИИ", flush=True)
            return False
        onnx_path = os.path.join(model_dir, "model.onnx")
        if not os.path.isfile(onnx_path):
            print(f"[SEMANTIC] {onnx_path} нет — работает rule-based fallback", flush=True)
            return False
        try:
            with self._lock:
                self._sess = ort.InferenceSession(
                    onnx_path, providers=["CPUExecutionProvider"],
                    sess_options=_sess_options(),
                )
                self._tok = AutoTokenizer.from_pretrained(model_dir, local_files_only=True)
                self._proto_embs = {
                    cat: self._embed(texts) for cat, texts in PROTOTYPES.items()
                }
                self.loaded = True
            print(f"[SEMANTIC] Загружена модель {onnx_path} (категорий: {len(self._proto_embs)})", flush=True)
            return True
        except Exception as e:
            print(f"[SEMANTIC] Ошибка загрузки {onnx_path}: {e} — fallback без ИИ", flush=True)
            self._sess = None
            self.loaded = False
            return False

    def _embed(self, texts: list[str]):
        enc = self._tok(texts, padding=True, truncation=True,
                        max_length=MAX_LEN, return_tensors="np")
        ids = enc["input_ids"].astype(np.int64)
        feed = {
            "input_ids": ids,
            "attention_mask": enc["attention_mask"].astype(np.int64),
        }
        if "token_type_ids" in {i.name for i in self._sess.get_inputs()}:
            feed["token_type_ids"] = np.zeros_like(ids)
        out = self._sess.run(["last_hidden_state"], feed)[0]
        mask = enc["attention_mask"][..., None].astype(np.float32)
        emb = (out * mask).sum(1) / np.clip(mask.sum(1), 1e-9, None)
        return emb / np.linalg.norm(emb, axis=1, keepdims=True).clip(min=1e-9)

    def predict(self, text: str) -> tuple[str, float]:
        """kNN-max: категория ближайшего эталона. Консервативно: угроза только
        при score >= THRESHOLD и марже над NONE >= MARGIN, иначе NONE."""
        if not self.available or not (text or "").strip():
            return ("NONE", 0.0)
        try:
            with self._lock:
                e = self._embed([text[:2000]])[0]
                sims = {cat: float((e @ emb.T).max())
                        for cat, emb in self._proto_embs.items()}
            best = max(CATEGORIES, key=lambda c: sims.get(c, -1.0))
            score = sims.get(best, 0.0)
            if best == "NONE":
                return ("NONE", round(sims.get("NONE", 0.0), 4))
            margin = score - sims.get("NONE", 0.0)
            if score >= SEMANTIC_THRESHOLD and margin >= SEMANTIC_MARGIN:
                return (best, round(score, 4))
            return ("NONE", round(score, 4))
        except Exception as e:
            print(f"[SEMANTIC] Ошибка инференса: {e} — fallback NONE", flush=True)
            return ("NONE", 0.0)


def _sess_options():
    if ort is None:
        return None
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = max(1, (os.cpu_count() or 4) // 2)
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return opts


MODEL = SemanticModel()
