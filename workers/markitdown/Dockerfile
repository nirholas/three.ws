FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

WORKDIR /app
COPY worker_security.py policy.py convert.py main.py fixtures.py /app/
COPY test_policy.py test_convert.py /app/

# Build gate: the image does not ship unless the request policy (type checks,
# size cap, zip-bomb guard) holds and a real file of every supported format
# converts inside the isolated, network-less child process.
RUN python test_policy.py && python test_convert.py

# Never run conversions as root.
RUN useradd --system --uid 10001 --no-create-home worker
USER worker

EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--no-server-header"]
