"""
Correction Engine — Business Logic Layer

Applies context-sensitive multipliers to raw ML predictions.
Separated from the ML layer so corrections can be:
  - A/B tested independently
  - overridden per-event by managers
  - fed back into retraining as labeled adjustments

The engine loads correction factors from `labor_correction_factors` in Supabase
and applies them as simple multipliers to the raw predicted headcount.
"""

import logging
import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

SUPABASE_URL = os.getenv('VITE_SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('VITE_SUPABASE_ANON_KEY')

logger = logging.getLogger(__name__)


class CorrectionEngine:
    """Loads and applies business correction multipliers."""

    def __init__(self):
        # Cheap construction — no I/O. Call load_factors() explicitly at startup.
        self.factors: dict[tuple[str, str], float] = {}

    def load_factors(self, client_factory=None) -> None:
        """Load correction factors from Supabase.

        Raises on connection or auth failure (caller should abort startup).
        Silently keeps factors={} when the table exists but has no matching rows.

        Args:
            client_factory: callable with signature (url, key) -> supabase client.
                Defaults to supabase.create_client. Pass an override in tests.
        """
        if client_factory is None:
            client_factory = create_client
        supabase = client_factory(SUPABASE_URL, SUPABASE_KEY)
        try:
            response = supabase.table('labor_correction_factors').select('*').execute()
        except Exception as exc:
            raise RuntimeError(
                f"CorrectionEngine: failed to load factors from Supabase — {exc}"
            ) from exc
        self.factors = {}
        for row in response.data:
            key = (row['event_type'], row['role'])
            self.factors[key] = float(row['correction_factor'])

    def apply(self, event_type: str, role: str, predicted: float) -> tuple[float, float]:
        """Apply correction factor to raw prediction.

        Returns:
            tuple[float, float]: (corrected_value, factor_used)
        """
        factor = self.factors.get((event_type, role), 1.0)
        return predicted * factor, factor

    def get_factor(self, event_type: str, role: str) -> float:
        """Get the correction factor for a given event type and role."""
        return self.factors.get((event_type, role), 1.0)

    def all_factors(self) -> dict[tuple[str, str], float]:
        """Return a copy of all loaded factors for inspection."""
        return dict(self.factors)
