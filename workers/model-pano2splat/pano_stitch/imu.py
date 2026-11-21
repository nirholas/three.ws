"""Horizon levelling from the camera IMU: our own complementary filter.

The filter keeps one orientation quaternion (camera body to a level view frame with y
down). The gyro advances it. The accelerometer pulls the predicted down direction toward
the measured one, with a gain that fades out when the sensor reads far from one g (the
camera is being accelerated, so it does not measure gravity). Heading is the direction of
the body forward axis projected on the horizontal plane. It is unwrapped, smoothed with a
Gaussian so the view follows the walk and ignores hand shake, and applied as a rotation
about the vertical axis.

IMU axes map to the body frame as x = IMU x, y = IMU z, z = -IMU y (measured on X3 and X5).
"""

import math

import numpy as np

GRAVITY_BAND = (0.85, 1.15)
TILT_TIME_CONSTANT_S = 1.5
HEADING_SIGMA_S = 1.2
BODY_FORWARD = np.array([0.0, 0.0, -1.0])  # lens 1 looks along -z of the body frame
IMU_TO_BODY = np.array([[1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, -1.0, 0.0]])


def _qmul(a, b):
    aw, ax, ay, az = a
    bw, bx, by, bz = b
    return (
        aw * bw - ax * bx - ay * by - az * bz,
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
    )


def _qexp(x, y, z):
    ang = math.sqrt(x * x + y * y + z * z)
    if ang < 1e-12:
        return (1.0, x * 0.5, y * 0.5, z * 0.5)
    s = math.sin(ang * 0.5) / ang
    return (math.cos(ang * 0.5), x * s, y * s, z * s)


def _qnorm(q):
    n = math.sqrt(q[0] ** 2 + q[1] ** 2 + q[2] ** 2 + q[3] ** 2)
    return (q[0] / n, q[1] / n, q[2] / n, q[3] / n)


def quat_to_matrix(q):
    w, x, y, z = q
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
            [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
            [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
        ]
    )


def matrix_to_quat(m):
    t = m[0, 0] + m[1, 1] + m[2, 2]
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        return _qnorm((0.25 * s, (m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s))
    i = int(np.argmax([m[0, 0], m[1, 1], m[2, 2]]))
    j, k = (i + 1) % 3, (i + 2) % 3
    s = math.sqrt(m[i, i] - m[j, j] - m[k, k] + 1.0) * 2
    q = [0.0] * 4
    q[i + 1] = 0.25 * s
    q[0] = (m[k, j] - m[j, k]) / s
    q[j + 1] = (m[j, i] + m[i, j]) / s
    q[k + 1] = (m[k, i] + m[i, k]) / s
    return _qnorm(tuple(q))


def level_view_basis(down_body, forward_body=BODY_FORWARD):
    """Matrix whose columns are the level view axes (right, down, forward) in body coordinates."""
    down = down_body / np.linalg.norm(down_body)
    fwd = forward_body - down * np.dot(forward_body, down)
    fwd /= np.linalg.norm(fwd)
    right = np.cross(down, fwd)
    return np.stack([right, down, fwd], axis=1)


def static_rotations(count, down_body=np.array([1.0, 0.0, 0.0])):
    """The same level basis for every frame, used when the file carries no IMU."""
    return np.repeat(level_view_basis(down_body)[None], count, axis=0)


def gaussian_smooth(values, sigma_samples):
    if sigma_samples < 0.5 or len(values) < 3:
        return values.copy()
    radius = int(math.ceil(sigma_samples * 3))
    x = np.arange(-radius, radius + 1)
    kernel = np.exp(-0.5 * (x / sigma_samples) ** 2)
    kernel /= kernel.sum()
    padded = np.pad(values, radius, mode="edge")
    return np.convolve(padded, kernel, mode="valid")


def track_orientation(t_s, accel_g, gyro_dps, gyro_sign=1.0, tilt_tau=TILT_TIME_CONSTANT_S):
    """Run the filter over all samples. Returns (down_body (N,3), quats (N,4)); both are
    expressed for the instant of each sample. quats map body vectors to the level view."""
    acc = accel_g @ IMU_TO_BODY.T
    gyr = np.radians(gyro_dps) @ IMU_TO_BODY.T * gyro_sign
    n = len(t_s)
    first = acc[: min(n, 200)].mean(axis=0)
    basis0 = level_view_basis(-first / np.linalg.norm(first))
    q = matrix_to_quat(basis0.T)
    quats = np.empty((n, 4))
    downs = np.empty((n, 3))
    anorm = np.linalg.norm(acc, axis=1)
    lo, hi = GRAVITY_BAND
    for i in range(n):
        dt = float(t_s[i] - t_s[i - 1]) if i else 0.0
        if 0.0 < dt < 0.1:
            wx, wy, wz = gyr[i]
            q = _qnorm(_qmul(q, _qexp(wx * dt, wy * dt, wz * dt)))
            if lo <= anorm[i] <= hi:
                w, x, y, z = q
                # predicted down in body coordinates: rotate (0,1,0) by the inverse of q
                dpx = 2 * (x * y + w * z)
                dpy = 1 - 2 * (x * x + z * z)
                dpz = 2 * (y * z - w * x)
                mx, my, mz = -acc[i] / anorm[i]
                ex, ey, ez = dpy * mz - dpz * my, dpz * mx - dpx * mz, dpx * my - dpy * mx
                k = min(1.0, dt / tilt_tau)
                q = _qnorm(_qmul(q, _qexp(-k * ex, -k * ey, -k * ez)))
        quats[i] = q
        w, x, y, z = q
        downs[i] = (2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x))
    return downs, quats


def heading_angles(quats):
    """Heading of the body forward axis in the level frame, unwrapped (radians)."""
    out = np.empty(len(quats))
    for i, q in enumerate(quats):
        m = quat_to_matrix(q)
        p = m @ BODY_FORWARD
        out[i] = math.atan2(p[0], p[2])
    return np.unwrap(out)


def frame_rotations(frame_t_s, imu_t_s, quats, heading_sigma_s=HEADING_SIGMA_S):
    """Per frame matrices from level view directions to body directions.

    Each frame uses the filtered orientation at its capture time and a heading that is the
    Gaussian smoothed heading, so the horizon is level and the view turns with the walk."""
    rate = (len(imu_t_s) - 1) / max(imu_t_s[-1] - imu_t_s[0], 1e-6)
    heading = heading_angles(quats)
    smooth = gaussian_smooth(heading, heading_sigma_s * rate)
    idx = np.clip(np.searchsorted(imu_t_s, frame_t_s), 0, len(imu_t_s) - 1)
    mats = np.empty((len(frame_t_s), 3, 3))
    for n, i in enumerate(idx):
        r = quat_to_matrix(quats[i])  # body -> level view with the camera's own heading
        delta = smooth[i] - heading[i]
        c, s = math.cos(delta), math.sin(delta)
        ry = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
        mats[n] = r.T @ ry
    return mats


def tilt_residual_deg(downs, accel_g, gyro_sign_check=None):
    """Mean angle between the filter's predicted down and the accelerometer (quiet samples)."""
    acc = accel_g @ IMU_TO_BODY.T
    nrm = np.linalg.norm(acc, axis=1)
    quiet = (nrm > GRAVITY_BAND[0]) & (nrm < GRAVITY_BAND[1])
    meas = -acc[quiet] / nrm[quiet, None]
    dots = np.clip((downs[quiet] * meas).sum(axis=1), -1, 1)
    return float(np.degrees(np.arccos(dots)).mean())
