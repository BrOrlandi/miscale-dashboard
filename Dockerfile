FROM python:3.12-slim

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ /srv/app/

ENV PYTHONUNBUFFERED=1 YUNMAI_DB=/data/yunmai.db
VOLUME /data
EXPOSE 8800
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8800/api/ping', timeout=4)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8800", "--proxy-headers", "--forwarded-allow-ips", "*"]
