"""Pure-logic tests for camera_rig.py: no torch, no GPU, no network."""

import math

import pytest

import camera_rig


def _flatten(matrix):
    return [value for row in matrix for value in row]


def test_front_azimuth_is_zero_and_matches_pixal3d_front_matrix():
    matrix = camera_rig.transform_matrix_for_azimuth(0.0, distance=3.1192)
    assert _flatten(matrix) == pytest.approx(
        _flatten(
            [
                [1.0, 0.0, 0.0, 0.0],
                [0.0, 0.0, -1.0, -3.1192],
                [0.0, 1.0, 0.0, 0.0],
                [0.0, 0.0, 0.0, 1.0],
            ]
        )
    )
    assert camera_rig.camera_position(matrix) == pytest.approx((0.0, -3.1192, 0.0))


@pytest.mark.parametrize(
    "azimuth,expected_position",
    [
        (0.0, (0.0, -1.0, 0.0)),
        (90.0, (1.0, 0.0, 0.0)),
        (180.0, (0.0, 1.0, 0.0)),
        (270.0, (-1.0, 0.0, 0.0)),
    ],
)
def test_orbit_positions_at_each_label_azimuth(azimuth, expected_position):
    matrix = camera_rig.transform_matrix_for_azimuth(azimuth, distance=1.0)
    assert camera_rig.camera_position(matrix) == pytest.approx(expected_position, abs=1e-9)


def test_matrix_stays_orthogonal_rotation_for_arbitrary_azimuth():
    matrix = camera_rig.transform_matrix_for_azimuth(37.0, distance=2.5)
    rotation = [row[:3] for row in matrix[:3]]
    # R^T R == I for a pure rotation.
    for i in range(3):
        for j in range(3):
            dot = sum(rotation[k][i] * rotation[k][j] for k in range(3))
            assert dot == pytest.approx(1.0 if i == j else 0.0, abs=1e-9)
    assert matrix[3] == [0.0, 0.0, 0.0, 1.0]


def test_resolve_azimuths_with_full_labels():
    azimuths = camera_rig.resolve_azimuths(["front", "right", "back", "left"])
    assert azimuths == [0.0, 90.0, 180.0, 270.0]


@pytest.mark.parametrize(
    "count,expected",
    [
        (1, [0.0]),
        (2, [0.0, 180.0]),
        (3, [0.0, 120.0, 240.0]),
        (4, [0.0, 90.0, 180.0, 270.0]),
    ],
)
def test_resolve_azimuths_even_spacing_fallback(count, expected):
    azimuths = camera_rig.resolve_azimuths([None] * count)
    assert azimuths == pytest.approx(expected)


def test_resolve_azimuths_partial_labels_spread_blanks_without_clustering():
    azimuths = camera_rig.resolve_azimuths(["front", None, None, None])
    assert azimuths[0] == 0.0
    # The three blanks take the 4-way even spacing in order, skipping index 0.
    assert azimuths[1:] == pytest.approx([90.0, 180.0, 270.0])


def test_resolve_azimuths_unrecognized_label_treated_as_unlabeled():
    azimuths = camera_rig.resolve_azimuths(["front", "top"])
    assert azimuths == pytest.approx([0.0, 180.0])


def test_resolve_azimuths_empty_input():
    assert camera_rig.resolve_azimuths([]) == []


def test_build_view_rig_shape_and_shared_camera_params():
    rig = camera_rig.build_view_rig(["front", "back"], distance=3.0, camera_angle_x=0.35)
    assert len(rig) == 2
    for view in rig:
        assert view["camera_distance"] == 3.0
        assert view["camera_angle_x"] == 0.35
        assert len(view["transform_matrix"]) == 4
        assert len(view["transform_matrix"][0]) == 4
    assert rig[0]["azimuth_degrees"] == 0.0
    assert rig[1]["azimuth_degrees"] == 180.0


def test_180_degree_rotation_is_negation_of_front_xy():
    front = camera_rig.transform_matrix_for_azimuth(0.0, distance=1.0)
    back = camera_rig.transform_matrix_for_azimuth(180.0, distance=1.0)
    fx, fy, fz = camera_rig.camera_position(front)
    bx, by, bz = camera_rig.camera_position(back)
    assert (bx, by, bz) == pytest.approx((-fx, -fy, fz))
