"""Regenerate only The Meridian signage; preserve the casino kit and gameplay assets."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from signage import build_plaque

if __name__ == '__main__':
    build_plaque('casino-sign', 'THE MERIDIAN', 'S L O P  C I T Y', 10, 1.7, .58, .035)
    build_plaque('casino-entry-sign', 'C A S I N O', '', 2.4, .5, .7, 0,
                 hanging_drop=.28, two_sided=True)
    build_plaque('casino-tagline', 'A little luck. Good company.', 'T H E  M E R I D I A N',
                 10, 2, .34, .015)
