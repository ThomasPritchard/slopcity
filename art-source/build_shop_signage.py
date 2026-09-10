"""Regenerate only the two Form & Thread signage source/export pairs."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from signage import build_plaque

if __name__ == '__main__':
    build_plaque('shop-sign', 'FORM & THREAD', 'S L O P  C I T Y', 5.5, .9, .58, .22)
    build_plaque('shop-tagline', 'Find your everyday.', 'F O R M  &  T H R E A D', 6, 1.4, .39, .015)
