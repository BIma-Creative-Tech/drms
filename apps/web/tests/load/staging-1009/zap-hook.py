# Staging load test 2026-10-09 — ZAP baseline hook (passive only; runbook README.md §ZAP).
# zap-baseline.py calls zap_started() once ZAP runs: every URL in ZAP_SEEDS (space separated) is requested once
# through ZAP, so the PASSIVE scanner sees the public pages and the public /api/v1 endpoints in addition to what
# the spider finds from the target. No active scan, no form submission (spider.postForm/processForm = false).
import os


def zap_started(zap, target):
    for url in os.environ.get('ZAP_SEEDS', '').split():
        try:
            zap.core.access_url(url=url, followredirects=True)
            print('seeded ' + url)
        except Exception as e:  # noqa: BLE001 — a failed seed must not stop the baseline
            print('seed failed ' + url + ': ' + str(e))
