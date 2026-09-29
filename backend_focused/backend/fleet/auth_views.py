"""Authentication endpoints.

The API is token-authenticated: every fleet endpoint requires a valid access
token. These four routes are the only anonymous ones, and they exist so a client
can obtain, renew, inspect and revoke that token.
"""

from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView


class LoginView(TokenObtainPairView):
    """Exchange username and password for an access/refresh pair.

    Explicitly ``AllowAny``: the project default is ``IsAuthenticated``, which
    would otherwise make logging in require being logged in.
    """

    permission_classes = [AllowAny]


class CurrentUserView(APIView):
    """Who the presented token belongs to.

    The frontend calls this on start-up to decide whether a stored token is
    still good, rather than trusting its own expiry arithmetic.
    """

    def get(self, request):
        user = request.user
        return Response(
            {
                'id': user.pk,
                'username': user.get_username(),
                'is_staff': user.is_staff,
            }
        )


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField()


class LogoutView(APIView):
    """Revoke a refresh token so it cannot be used again.

    Without this, signing out only forgets the tokens client-side and the
    refresh token stays valid until it expires. Blacklisting makes sign-out
    take effect server-side too.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LogoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            RefreshToken(serializer.validated_data['refresh']).blacklist()
        except TokenError:
            # Already expired, already blacklisted, or malformed. The caller
            # wanted to be signed out and they are; reporting an error would
            # only strand them on the login screen.
            pass

        return Response(status=status.HTTP_205_RESET_CONTENT)
