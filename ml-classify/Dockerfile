# ml-classify: локальная SLM (rubert-tiny2, ONNX, CPU) — primary,
# GigaChat — fallback при её ошибке/отсутствии.
# Stage 1 экспортирует веса из HuggingFace (интернет нужен ТОЛЬКО на сборке);
# stage 2 — slim-рантайм без torch (~300-400 МБ образ, ~222 МБ RAM — в лимит 4 ГБ).
# Без сети на сборке stage 1 упадёт — собирать там, где HF доступен.

# ---------- stage 1: exporter (torch+optimum только здесь) ----------
FROM python:3.12-slim AS exporter
WORKDIR /export
# torch CPU-only, иначе притащит CUDA-колёса на гигабайты
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir "optimum[onnxruntime]"
COPY scripts/download_model.py ./download_model.py
ENV HF_MODEL_ID=cointegrated/rubert-tiny2
RUN python download_model.py --out /models/rubert-tiny2

# ---------- stage 2: runtime (без torch/transformers) ----------
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY --from=exporter /models/rubert-tiny2 ./models/rubert-tiny2
EXPOSE 8003
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8003"]
