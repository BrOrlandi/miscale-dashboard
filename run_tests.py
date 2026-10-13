import sys
import unittest

if __name__ == "__main__":
    # Test scale
    from tests.packets import broadcast_packet, gatt_measured_packet, gatt_measuring_packet
    from tests import test_scale, test_body, test_session, test_api

    print("Running test_scale...")
    test_scale.test_parse_broadcast_measuring()
    test_scale.test_parse_broadcast_stabilized()
    test_scale.test_parse_gatt_measuring()
    test_scale.test_parse_gatt_measured()
    test_scale.test_listener_dedupes_and_filters()
    print("  PASS: test_scale")

    print("Running test_body...")
    test_body.test_age_calculation()
    test_body.test_compute_without_impedance()
    test_body.test_compute_with_impedance()
    print("  PASS: test_body")

    print("Running test_session...")
    test_session.test_session_handling_and_profile_matching()
    print("  PASS: test_session")

    print("Running test_api...")
    test_api.test_ping()
    test_api.test_status()
    test_api.test_profile_crud()
    print("  PASS: test_api")

    print("\nALL TESTS PASSED SUCCESSFULLY!")
