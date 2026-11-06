#!/usr/bin/env bash
# Follow the Oh Hi ExApp container's logs (pass extra `docker logs` flags, e.g. --since 5m).
exec docker logs -f "$@" nc_app_ohhi
