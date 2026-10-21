#!/usr/bin/env bash
# Prospect scores, projections and Freshman Watch for the current season. 6 API calls. Each step keeps
# going if an earlier one fails, so one bad endpoint doesn't block the rest.
YEAR="${YEAR:-$(date -u +%Y)}"
python -u projections.py fetch-schedule "$YEAR" || echo "schedule/lines fetch failed"
python -u history_backfill.py --first "$YEAR" --last "$YEAR" --refresh --kinds player-stats,team-stats,ppa,usage --max-calls 4 || echo "prospect refresh failed"
python -u prospect_model.py score || echo "prospect scoring failed"
python -u projections.py build "$YEAR" || echo "projections failed"
python -u freshmen.py "$YEAR" || echo "freshmen failed"
