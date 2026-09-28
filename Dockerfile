FROM mcr.microsoft.com/powershell:7.5-debian-12@sha256:7ab5bd5ca6f95a3351fa0c6a1205237d57048c94542355aab55519a0861a9b25

WORKDIR /app
COPY exporter.ps1 ./
COPY src ./src

EXPOSE 9187
USER 65532:65532

ENTRYPOINT ["pwsh", "-NoLogo", "-NoProfile", "-NonInteractive", "-File", "/app/exporter.ps1"]
CMD ["-ListenAddress", "0.0.0.0", "-Port", "9187", "-Simulation"]
