#!/usr/bin/env bash
# Creates the Kafka topics this project uses.
#
# Auto-topic-creation is deliberately disabled on the broker, so topics must be
# declared here. That is the safer default: with auto-create on, a typo in a
# topic name silently produces into a brand-new topic that nothing consumes, and
# the bug shows up as "messages disappearing" rather than an error.
#
# Safe to re-run — existing topics are reported and left alone.
set -uo pipefail

BROKER="${BROKER:-localhost:9092}"
KT="/opt/kafka/bin/kafka-topics.sh"

# name:partitions
TOPICS=(
  "booking-events:3"
)

for entry in "${TOPICS[@]}"; do
  name="${entry%%:*}"
  partitions="${entry##*:}"

  if docker exec airline-kafka "$KT" --bootstrap-server "$BROKER" --list 2>/dev/null | grep -qx "$name"; then
    echo "  $name: already exists"
    continue
  fi

  # PARTITIONS are the unit of parallelism AND of ordering. Kafka guarantees
  # order only within a partition, never across them. Producers key each event
  # by flight_id, so every event for one flight lands in the same partition and
  # is therefore consumed in the order it was written. Three partitions means up
  # to three consumers in a group can work in parallel.
  #
  # Replication factor is 1 because there is one broker. Production uses 3.
  docker exec airline-kafka "$KT" --bootstrap-server "$BROKER" \
    --create --topic "$name" --partitions "$partitions" --replication-factor 1
done

echo
echo "topics now on the broker:"
docker exec airline-kafka "$KT" --bootstrap-server "$BROKER" --list | sed 's/^/  /'
