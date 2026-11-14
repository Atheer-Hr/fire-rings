"""Run every pipeline stage in order: ingest -> aggregate -> harmonize -> forecast -> export.

    python pipeline/run_all.py            # everything
    python pipeline/run_all.py --skip-ml  # quick rebuild without retraining the model
"""
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent
stages = ["ingest", "aggregate", "harmonize", "forecast", "export"]
if "--skip-ml" in sys.argv:
    stages.remove("forecast")

for s in stages:
    t = time.time()
    print(f"\n=== {s} ===", flush=True)
    r = subprocess.run([sys.executable, "-u", str(HERE / f"{s}.py")])
    if r.returncode:
        sys.exit(f"{s} failed")
    print(f"=== {s} done in {time.time() - t:.0f}s ===", flush=True)
