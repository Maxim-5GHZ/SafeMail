"""Скачивание rubert-tiny2 + экспорт в ONNX (./models/rubert-tiny2/).

Запуск с хоста (нужен интернет):
    /tmp/opencode/slmproto/bin/python ml-classify/scripts/download_model.py [--out ./models/rubert-tiny2]

В Docker entrypoint сам докачает при первом старте, если /models пуст
и есть сеть; без сети — продолжит с rule-based fallback.
Требует torch+optimum только здесь (в рантайме их нет).
"""
import argparse
import os
import sys

HF_MODEL_ID = os.getenv("HF_MODEL_ID", "cointegrated/rubert-tiny2")
DEFAULT_OUT = os.getenv("MODEL_DIR", "./models/rubert-tiny2")


def main() -> int:
    ap = argparse.ArgumentParser(description="Скачать rubert-tiny2 и экспортировать в ONNX")
    ap.add_argument("--model", default=HF_MODEL_ID, help="HF id исходной модели")
    ap.add_argument("--out", default=DEFAULT_OUT, help="Каталог для model.onnx + tokenizer")
    args = ap.parse_args()

    try:
        from optimum.exporters.onnx import main_export
    except ImportError:
        print("Нужны torch и optimum: pip install torch optimum[onnxruntime]", flush=True)
        return 1

    os.makedirs(args.out, exist_ok=True)
    if os.path.isfile(os.path.join(args.out, "model.onnx")):
        print(f"[DOWNLOAD] {args.out}/model.onnx уже есть — пропуск", flush=True)
        return 0
    print(f"[DOWNLOAD] Экспорт {args.model} -> {args.out} ...", flush=True)
    main_export(args.model, output=args.out, task="feature-extraction")
    size_mb = os.path.getsize(os.path.join(args.out, "model.onnx")) / 1e6
    print(f"[DOWNLOAD] Готово, model.onnx ~{size_mb:.0f}MB", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
