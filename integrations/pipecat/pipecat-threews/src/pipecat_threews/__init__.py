#
# Copyright (c) 2026, three.ws
#
# SPDX-License-Identifier: Apache-2.0
#

"""Pipecat frame processor publishing three.ws 3D avatar motion data."""

from .avatar import ThreeWsAvatarProcessor, gesture_for_text

__all__ = ["ThreeWsAvatarProcessor", "gesture_for_text"]

__version__ = "0.1.0"
