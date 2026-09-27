FROM mcr.microsoft.com/powershell:7.4-debian-12@sha256:206a748b34deec1b64553fcfa92294fc871c2df5855e9f340df172756bef201f

WORKDIR /app
COPY exporter.ps1 ./
COPY src ./src

EXPOSE 9187
USER 65532:65532

ENTRYPOINT ["pwsh", "-NoLogo", "-NoProfile", "-NonInteractive", "-File", "/app/exporter.ps1"]
CMD ["-ListenAddress", "0.0.0.0", "-Port", "9187", "-Simulation"]
