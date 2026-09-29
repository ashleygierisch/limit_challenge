from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from fleet import auth_views, views

router = DefaultRouter()
router.register('offices', views.OfficeViewSet, basename='office')
router.register('mechanics', views.MechanicViewSet, basename='mechanic')
router.register('vehicles', views.VehicleViewSet, basename='vehicle')
router.register(
    'maintenance-records',
    views.MaintenanceRecordViewSet,
    basename='maintenancerecord',
)

urlpatterns = [
    path('auth/login/', auth_views.LoginView.as_view(), name='login'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='token-refresh'),
    path('auth/logout/', auth_views.LogoutView.as_view(), name='logout'),
    path('auth/me/', auth_views.CurrentUserView.as_view(), name='current-user'),
    path('', include(router.urls)),
]
