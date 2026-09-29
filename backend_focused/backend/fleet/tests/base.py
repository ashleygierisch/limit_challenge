"""Shared base class for tests that call the API.

Every fleet endpoint requires authentication, so a test client that is not
signed in gets 401 and tests nothing useful.

``force_authenticate`` is used rather than a real token because decoding one
costs a database query to load the user, which would inflate every count in
``test_performance`` and obscure the thing those tests exist to measure. The
token path itself is covered separately in ``test_auth``.
"""

from django.contrib.auth.models import User
from rest_framework.test import APITestCase


class AuthenticatedAPITestCase(APITestCase):
    """An API test case whose client is signed in."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        # No password: force_authenticate does not check one, and hashing it for
        # every test added ~40s to the suite.
        cls.user = User.objects.create_user(username='tester')

    def setUp(self):
        super().setUp()
        self.client.force_authenticate(user=self.user)
