# Getting the data and running the pipeline

1. Accept the PopSign ASL v1.0 terms on Kaggle and create an API token
   (`~/.kaggle/kaggle.json`). Download the videos and the label CSV.
2. Build `manifest.csv` with columns `video_path,sign,signer_id` (one row per
   video, 250 distinct signs).
3. Download the MediaPipe `holistic_landmarker.task` bundle.
4. `python prepare_popsign.py --manifest manifest.csv --out data/ --holistic-model holistic_landmarker.task`
   Writes `train/val/test.tfrecord`, `labels.json`, `counts.json`. Splits are by
   signer so test accuracy measures new people.
5. On a GPU machine: `python train_islr.py --data data/ --out out/`
6. `python eval_islr.py --data data/ --model out/sign_model.tflite --labels out/sign_labels.json`
   Exit 0 means top-1 is at least 0.80.
7. Copy `out/sign_model.tflite` and `out/sign_labels.json` into
   `../signs-weights/`, then rebuild the worker image (the Dockerfile copies that
   directory).

Install: `pip install tensorflow mediapipe opencv-python ai-edge-litert numpy`.
