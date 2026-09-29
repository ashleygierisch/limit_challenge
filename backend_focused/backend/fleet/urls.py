from django.urls import include, path
from rest_framework.routers import DefaultRouter

from fleet import views

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
    path('', include(router.urls)),
]
