import pytest

from request_policy import MAX_OBJECTS, RequestRejected, validate_request

PHOTO = "https://example.com/room.jpg"
BOX = [0.1, 0.2, 0.5, 0.8]


def test_boxes_request_is_normalized():
    out = validate_request({"image_url": PHOTO, "boxes": [BOX, [0.5, 0.5, 0.9, 0.9]]})
    assert out["image_url"] == PHOTO
    assert out["mask_urls"] == []
    assert out["boxes"][0] == (0.1, 0.2, 0.5, 0.8)
    assert out["max_objects"] == 8
    assert out["seed"] is None


def test_masks_request():
    out = validate_request({"image_url": PHOTO, "mask_urls": ["https://example.com/a.png"], "seed": 7})
    assert out["mask_urls"] == ["https://example.com/a.png"]
    assert out["boxes"] == []
    assert out["seed"] == 7


@pytest.mark.parametrize("payload", [None, [], "x", 3])
def test_body_must_be_an_object(payload):
    with pytest.raises(RequestRejected):
        validate_request(payload)


def test_photo_required():
    with pytest.raises(RequestRejected, match="image_url"):
        validate_request({"boxes": [BOX]})


def test_must_name_objects():
    with pytest.raises(RequestRejected, match="name the objects"):
        validate_request({"image_url": PHOTO})
    with pytest.raises(RequestRejected, match="name the objects"):
        validate_request({"image_url": PHOTO, "boxes": [], "mask_urls": []})


def test_masks_and_boxes_are_exclusive():
    with pytest.raises(RequestRejected, match="not both"):
        validate_request({"image_url": PHOTO, "boxes": [BOX], "mask_urls": ["https://example.com/a.png"]})


@pytest.mark.parametrize(
    "box",
    [
        [0.5, 0.2, 0.4, 0.8],  # x1 < x0
        [-0.1, 0.2, 0.5, 0.8],  # outside the frame
        [0.1, 0.2, 0.5, 1.2],
        [0.1, 0.2, 0.12, 0.8],  # sliver
        [0.1, 0.2, 0.5],  # wrong arity
        [0.1, 0.2, "a", 0.8],
        [0.1, 0.2, float("nan"), 0.8],
    ],
)
def test_bad_boxes_are_rejected(box):
    with pytest.raises(RequestRejected, match=r"boxes\[0\]"):
        validate_request({"image_url": PHOTO, "boxes": [box]})


def test_object_cap():
    with pytest.raises(RequestRejected, match="max_objects"):
        validate_request({"image_url": PHOTO, "boxes": [BOX] * 3, "max_objects": 2})
    with pytest.raises(RequestRejected, match="max_objects"):
        validate_request({"image_url": PHOTO, "boxes": [BOX], "max_objects": MAX_OBJECTS + 1})
    with pytest.raises(RequestRejected, match="max_objects"):
        validate_request({"image_url": PHOTO, "boxes": [BOX], "max_objects": True})


@pytest.mark.parametrize("seed", [-1, 1.5, True, "3"])
def test_bad_seed(seed):
    with pytest.raises(RequestRejected, match="seed"):
        validate_request({"image_url": PHOTO, "boxes": [BOX], "seed": seed})


def test_url_limits():
    with pytest.raises(RequestRejected, match="image_url"):
        validate_request({"image_url": "x" * 5000, "boxes": [BOX]})
    with pytest.raises(RequestRejected, match=r"mask_urls\[0\]"):
        validate_request({"image_url": PHOTO, "mask_urls": [""]})
