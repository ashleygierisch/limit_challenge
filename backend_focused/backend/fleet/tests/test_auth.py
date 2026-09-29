"""Authentication tests.

The rest of the suite signs its client in with ``force_authenticate``, which
skips token encoding and decoding entirely. These tests cover the real path: a
request with no credentials, a login, a genuine ``Authorization`` header, a
refresh, and a sign-out.
"""

from django.contrib.auth.models import User
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from fleet.tests.factories import make_office

USERNAME = 'fleet-user'
PASSWORD = 'a-real-password-123'


class AnonymousAccessTests(APITestCase):
    """Every fleet endpoint requires a token."""

    def test_endpoints_reject_anonymous_requests(self):
        make_office()

        protected = [
            reverse('office-list'),
            reverse('office-summary'),
            reverse('mechanic-list'),
            reverse('mechanic-workload'),
            reverse('vehicle-list'),
            reverse('vehicle-needing-maintenance'),
            reverse('vehicle-check-duplicate'),
            reverse('maintenancerecord-list'),
        ]

        for url in protected:
            with self.subTest(url=url):
                response = self.client.get(url)
                self.assertEqual(status.HTTP_401_UNAUTHORIZED, response.status_code)

    def test_writes_reject_anonymous_requests(self):
        """Read-only access is not quietly allowed either."""
        response = self.client.post(
            reverse('office-list'), {'name': 'Sneaky', 'city': 'Nowhere'}, format='json'
        )

        self.assertEqual(status.HTTP_401_UNAUTHORIZED, response.status_code)

    def test_login_itself_is_reachable_without_a_token(self):
        """Otherwise signing in would require being signed in."""
        response = self.client.post(
            reverse('login'), {'username': 'nobody', 'password': 'wrong'}, format='json'
        )

        # Rejected on the credentials, not on the missing token.
        self.assertEqual(status.HTTP_401_UNAUTHORIZED, response.status_code)
        self.assertNotIn('detail', response.json().get('messages', {}))


class LoginTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username=USERNAME, password=PASSWORD)

    def login(self, password=PASSWORD):
        return self.client.post(
            reverse('login'),
            {'username': USERNAME, 'password': password},
            format='json',
        )

    def test_valid_credentials_return_a_token_pair(self):
        response = self.login()

        self.assertEqual(status.HTTP_200_OK, response.status_code)
        body = response.json()
        self.assertIn('access', body)
        self.assertIn('refresh', body)

    def test_wrong_password_is_rejected(self):
        self.assertEqual(
            status.HTTP_401_UNAUTHORIZED, self.login(password='not-it').status_code
        )

    def test_access_token_unlocks_the_api(self):
        """The real header path, not force_authenticate."""
        make_office()
        access = self.login().json()['access']

        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')
        response = self.client.get(reverse('office-list'))

        self.assertEqual(status.HTTP_200_OK, response.status_code)

    def test_a_garbage_token_is_rejected(self):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer not-a-real-token')

        response = self.client.get(reverse('office-list'))

        self.assertEqual(status.HTTP_401_UNAUTHORIZED, response.status_code)

    def test_current_user_identifies_the_token_holder(self):
        """The frontend uses this to validate a stored token on start-up."""
        access = self.login().json()['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')

        body = self.client.get(reverse('current-user')).json()

        self.assertEqual(USERNAME, body['username'])
        self.assertEqual(self.user.pk, body['id'])


class RefreshTests(APITestCase):
    def setUp(self):
        User.objects.create_user(username=USERNAME, password=PASSWORD)
        self.tokens = self.client.post(
            reverse('login'),
            {'username': USERNAME, 'password': PASSWORD},
            format='json',
        ).json()

    def test_refresh_returns_a_working_access_token(self):
        response = self.client.post(
            reverse('token-refresh'), {'refresh': self.tokens['refresh']}, format='json'
        )

        self.assertEqual(status.HTTP_200_OK, response.status_code)
        access = response.json()['access']

        make_office()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')
        self.assertEqual(
            status.HTTP_200_OK, self.client.get(reverse('office-list')).status_code
        )

    def test_rotation_invalidates_the_previous_refresh_token(self):
        """ROTATE_REFRESH_TOKENS + blacklisting: a used token cannot be replayed."""
        first = self.tokens['refresh']

        self.client.post(reverse('token-refresh'), {'refresh': first}, format='json')
        replay = self.client.post(
            reverse('token-refresh'), {'refresh': first}, format='json'
        )

        self.assertEqual(status.HTTP_401_UNAUTHORIZED, replay.status_code)

    def test_rotation_issues_a_new_refresh_token(self):
        response = self.client.post(
            reverse('token-refresh'), {'refresh': self.tokens['refresh']}, format='json'
        )

        self.assertIn('refresh', response.json())
        self.assertNotEqual(self.tokens['refresh'], response.json()['refresh'])


class LogoutTests(APITestCase):
    def setUp(self):
        User.objects.create_user(username=USERNAME, password=PASSWORD)
        self.tokens = self.client.post(
            reverse('login'),
            {'username': USERNAME, 'password': PASSWORD},
            format='json',
        ).json()

    def test_logout_revokes_the_refresh_token(self):
        """Sign-out takes effect server-side, not only in the browser."""
        response = self.client.post(
            reverse('logout'), {'refresh': self.tokens['refresh']}, format='json'
        )
        self.assertEqual(status.HTTP_205_RESET_CONTENT, response.status_code)

        reuse = self.client.post(
            reverse('token-refresh'), {'refresh': self.tokens['refresh']}, format='json'
        )
        self.assertEqual(status.HTTP_401_UNAUTHORIZED, reuse.status_code)

    def test_logging_out_twice_is_not_an_error(self):
        """The caller wanted to be signed out; they are."""
        for _ in range(2):
            response = self.client.post(
                reverse('logout'), {'refresh': self.tokens['refresh']}, format='json'
            )
            self.assertEqual(status.HTTP_205_RESET_CONTENT, response.status_code)

    def test_logout_requires_a_refresh_token(self):
        response = self.client.post(reverse('logout'), {}, format='json')

        self.assertEqual(status.HTTP_400_BAD_REQUEST, response.status_code)
        self.assertIn('refresh', response.json())
