"""Custom DRF exception handling."""

from django.db import IntegrityError
from django.db.models import ProtectedError
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler


def fleet_exception_handler(exc, context):
    """Translate database-level conflicts into 409 responses.

    DRF recognises neither ``IntegrityError`` nor ``ProtectedError``, so both
    would otherwise surface as an unhandled 500 for what is really a conflict
    the caller can resolve. Offices and mechanics are referenced with
    ``on_delete=PROTECT`` so deleting one never silently destroys maintenance
    history.
    """
    if isinstance(exc, IntegrityError):
        # Serializers validate uniqueness first, but that check and the INSERT
        # are not atomic, so concurrent requests can both pass it. A 409 is
        # honest about the race; a 500 would blame the server.
        return Response(
            {
                'detail': (
                    'This change conflicts with an existing record. It may '
                    'have been created by another request just now -- reload '
                    'and try again.'
                )
            },
            status=status.HTTP_409_CONFLICT,
        )

    if isinstance(exc, ProtectedError):
        referenced = len(exc.protected_objects)
        return Response(
            {
                'detail': (
                    f'Cannot delete this record because {referenced} related '
                    f'record(s) still reference it. Reassign or remove them '
                    f'first, or mark this record inactive instead.'
                )
            },
            status=status.HTTP_409_CONFLICT,
        )

    return drf_exception_handler(exc, context)
