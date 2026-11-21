# Throwaway proof image: the production model-video2motion image (built from
# workers/model-video2motion/Dockerfile, passed in as BASE) plus the job driver.
ARG BASE
FROM ${BASE}
COPY local_equirect.py /app/local_equirect.py
COPY run.py /app/run.py
CMD ["python", "/app/run.py"]
