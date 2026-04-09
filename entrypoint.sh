#!/bin/sh
mkdir -p "${CREWAI_STORAGE_DIR:-/data/crewai}/memory"
mkdir -p "${CREWAI_STORAGE_DIR:-/data/crewai}/knowledge"

exec uvicorn app:app --host 0.0.0.0 --port "${PORT:-8000}"
