#!/usr/bin/env bash
set -euo pipefail

: "${FORGEJO_URL:?FORGEJO_URL is required}"
: "${REGISTRY_TOKEN:?REGISTRY_TOKEN is required}"
: "${OWNER:?OWNER is required}"
: "${IMAGE:?IMAGE is required}"

retention_days="${RETENTION_DAYS:-14}"
if [[ ! "$retention_days" =~ ^[0-9]+$ ]]; then
  echo "RETENTION_DAYS must be a whole number" >&2
  exit 1
fi

api="${FORGEJO_URL%/}/api/v1"
auth="Authorization: token ${REGISTRY_TOKEN}"
cutoff="$(date -u -d "${retention_days} days ago" +%s)"
versions="$(mktemp)"
trap 'rm -f "$versions"' EXIT

page=1
while :; do
  response="$(curl -fsS -H "$auth" "${api}/packages/${OWNER}?type=container&q=${IMAGE}&limit=50&page=${page}")"
  count="$(jq 'length' <<<"$response")"
  (( count == 0 )) && break

  jq -r --arg image "$IMAGE" '.[] | select(.name == $image) | [.version, .created_at] | @tsv' <<<"$response" >> "$versions"
  (( count < 50 )) && break
  ((page++))
done

while IFS=$'\t' read -r version created_at; do
  [[ "$version" =~ ^(sha-[0-9a-f]{7,40}|build-(amd64|arm64)-[0-9a-f]{7,40})$ ]] || continue

  created_epoch="$(date -u -d "$created_at" +%s 2>/dev/null)" || continue
  if (( created_epoch < cutoff )); then
    encoded_version="$(jq -rn --arg value "$version" '$value|@uri')"
    echo "Deleting ${IMAGE}:${version} (created ${created_at})"
    curl -fsS -H "$auth" -X DELETE "${api}/packages/${OWNER}/container/${IMAGE}/${encoded_version}" >/dev/null
  fi
done < "$versions"
