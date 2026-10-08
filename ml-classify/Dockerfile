# ml-classify: одностадийная сборка — локальной SLM больше нет.
# Инференс: Mistral через OpenRouter (primary, env OPENROUTER_API_KEY)
# + GigaChat (fallback, env GIGACHAT_API_KEY).
# Без ключей/сети сервис стартует и работает в rule-based fallback.
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
EXPOSE 8003
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8003"]
