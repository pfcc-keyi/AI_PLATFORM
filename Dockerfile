FROM python:3.13-slim

WORKDIR /app

COPY source/crewai/ /app/source/crewai/
COPY source/crewai-tools/ /app/source/crewai-tools/

RUN pip install --no-cache-dir -e /app/source/crewai/
RUN pip install --no-cache-dir -e /app/source/crewai-tools/ || true

COPY pyproject.toml .
RUN pip install --no-cache-dir .

COPY app.py config.py entrypoint.sh ./
COPY tools/ tools/
COPY flows/ flows/
COPY crews/ crews/
COPY api/ api/
COPY setup/ setup/
COPY knowledge/ knowledge/
COPY models/ models/

RUN chmod +x entrypoint.sh

ENV CREWAI_STORAGE_DIR=/data/crewai

EXPOSE 8000
ENTRYPOINT ["./entrypoint.sh"]
