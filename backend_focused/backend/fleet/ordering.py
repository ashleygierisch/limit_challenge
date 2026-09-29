"""Ordering support for the list endpoints.

DRF's ``OrderingFilter`` does the whitelisting well, but leaves two things to
chance that matter for a paginated table:

1. **NULL placement** is left to the database. SQLite sorts NULLs first and
   PostgreSQL last, so "sort by last service" would reorder itself on a change
   of backend. Ordering is built from explicit ``F(...).asc(nulls_first=True)``
   expressions instead.

2. **Ties are unresolved.** Sorting by a low-cardinality column -- ``active``
   has two values -- leaves rows within a tie in whatever order the database
   returns, which differs between pages. A row can then appear on two pages or
   on none. Every ordering therefore ends with a unique tiebreaker.
"""

from django.db.models import F
from rest_framework.filters import OrderingFilter


class FleetOrderingFilter(OrderingFilter):
    """``?ordering=`` with deterministic NULL placement and stable paging.

    Accepts a comma-separated list, so a column rendered from several fields
    ("Vehicle" is make, model and year) can sort by all of them. Terms not in
    the view's ``ordering_fields`` are dropped, falling back to the endpoint's
    default order. Views set ``ordering_tiebreaker`` to a unique column.
    """

    def filter_queryset(self, request, queryset, view):
        ordering = self.get_ordering(request, queryset, view)

        # No ordering requested: leave the queryset's own ordering alone. Each
        # report has a deliberate default (most overdue first, busiest first)
        # that must survive an unsorted request.
        if not ordering:
            return queryset

        expressions = []
        for term in ordering:
            descending = term.startswith('-')
            field = term[1:] if descending else term
            expression = F(field)
            expressions.append(
                expression.desc(nulls_last=True)
                if descending
                else expression.asc(nulls_first=True)
            )

        tiebreaker = getattr(view, 'ordering_tiebreaker', 'pk')
        if tiebreaker not in {term.lstrip('-') for term in ordering}:
            expressions.append(F(tiebreaker).asc())

        return queryset.order_by(*expressions)
