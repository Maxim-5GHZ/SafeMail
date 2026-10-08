# ml-classify: двухстадийная сборка — веса запекаются В ОБРАЗ.
# На хосте ./models НЕ нужен, volume-mount не требуется: рантайм читает
# /models/rubert-tiny2 из образа (дефолт MODEL_DIR в app/main.py).
# Сборке нужен интернет (скачивание весов с HuggingFace в stage 1).

# Stage 1: экспорт PyTorch -> ONNX (torch живёт только здесь).
FROM python:3.12-slim AS exporter
ARG HF_MODEL_ID=cointegrated/rubert-tiny2
WORKDIR /export
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch \
 && pip install --no-cache-dir "optimum[onnxruntime]" huggingface-hub
COPY scripts/download_model.py ./
ENV HF_MODEL_ID=${HF_MODEL_ID}
RUN python download_model.py --out /models/rubert-tiny2

# Stage 2: рантайм (лёгкий, без torch).
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY --from=exporter /models/rubert-tiny2 /models/rubert-tiny2
EXPOSE 8003
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8003"]
