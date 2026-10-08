#!/bin/bash
# Дамп кодовой базы + докеров + nginx-конфигов в один файл (для ревью/LLM).
# Секреты НЕ дампятся: .env, .env.prod, nginx/certs, *.key/*.pem/*.crt, models/.
set -u

OUTPUT_FILE="all_code.txt"
> "$OUTPUT_FILE"

find . -type f \( \
    -name "*.py" \
    -o -name "*.java" \
    -o -name "*.ts" -o -name "*.tsx" \
    -o -name "*.js" \
    -o -name "*.sql" \
    -o -name "Dockerfile*" \
    -o -name "docker-compose*.yml" \
    -o -name "*.yml" \
    -o -name "nginx.conf" \
    -o -name "*.sh" \
    -o -name ".env.example" \
    -o -name "requirements.txt" \
    -o -name "package.json" \
    -o -name "pom.xml" \
    -o -name "AGENTS.md" \
  \) \
  -not -path "./.git/*" \
  -not -path "./frontend/node_modules/*" \
  -not -path "./frontend/.next/*" \
  -not -path "./gateway-java/target/*" \
  -not -path "./models/*" \
  -not -path "./nginx/certs/*" \
  -not -path "*/__pycache__/*" \
  -not -path "*/.venv/*" \
  -not -path "*/venv/*" \
  -not -name "*.key" -not -name "*.pem" -not -name "*.crt" \
  -not -name "package-lock.json" -not -name "tsconfig.tsbuildinfo" \
  -print0 | sort -z | while IFS= read -r -d $'\0' file; do
    echo "File: $file" >> "$OUTPUT_FILE"
    cat "$file" >> "$OUTPUT_FILE"
    echo -e "\n\n============================================================\n\n" >> "$OUTPUT_FILE"
done

echo "Dumped into $OUTPUT_FILE"
