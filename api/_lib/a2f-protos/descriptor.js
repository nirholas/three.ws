// GENERATED FILE: do not edit by hand.
// Regenerate with: node scripts/generate-a2f-descriptor.mjs
// protobufjs JSON descriptor for NVIDIA Audio2Face-3D (ACE): the
// nvidia_ace.services.a2f_controller.v1.A2FControllerService gRPC surface,
// parsed (keepCase) from the vendored protos in api/_lib/a2f-protos/*.proto,
// themselves from https://github.com/NVIDIA/Audio2Face-3D-Samples.
// SPDX-FileCopyrightText: Copyright (c) 2024 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
export default {
	"nested": {
		"google": {
			"nested": {
				"protobuf": {
					"nested": {
						"Any": {
							"fields": {
								"type_url": {
									"type": "string",
									"id": 1
								},
								"value": {
									"type": "bytes",
									"id": 2
								}
							}
						},
						"Empty": {
							"fields": {}
						}
					}
				}
			}
		},
		"nvidia_ace": {
			"nested": {
				"audio": {
					"nested": {
						"v1": {
							"nested": {
								"AudioHeader": {
									"fields": {
										"audio_format": {
											"type": "AudioFormat",
											"id": 1
										},
										"channel_count": {
											"type": "uint32",
											"id": 2
										},
										"samples_per_second": {
											"type": "uint32",
											"id": 3
										},
										"bits_per_sample": {
											"type": "uint32",
											"id": 4
										}
									},
									"nested": {
										"AudioFormat": {
											"values": {
												"AUDIO_FORMAT_PCM": 0
											}
										}
									}
								}
							}
						}
					}
				},
				"animation_id": {
					"nested": {
						"v1": {
							"nested": {
								"AnimationIds": {
									"fields": {
										"request_id": {
											"type": "string",
											"id": 1
										},
										"stream_id": {
											"type": "string",
											"id": 2
										},
										"target_object_id": {
											"type": "string",
											"id": 3
										}
									}
								}
							}
						}
					}
				},
				"status": {
					"nested": {
						"v1": {
							"nested": {
								"Status": {
									"fields": {
										"code": {
											"type": "Code",
											"id": 1
										},
										"message": {
											"type": "string",
											"id": 2
										}
									},
									"nested": {
										"Code": {
											"values": {
												"SUCCESS": 0,
												"INFO": 1,
												"WARNING": 2,
												"ERROR": 3
											}
										}
									}
								}
							}
						}
					}
				},
				"emotion_with_timecode": {
					"nested": {
						"v1": {
							"nested": {
								"EmotionWithTimeCode": {
									"fields": {
										"time_code": {
											"type": "double",
											"id": 1
										},
										"emotion": {
											"keyType": "string",
											"type": "float",
											"id": 2
										}
									}
								}
							}
						}
					}
				},
				"emotion_aggregate": {
					"nested": {
						"v1": {
							"nested": {
								"EmotionAggregate": {
									"fields": {
										"input_emotions": {
											"rule": "repeated",
											"type": "nvidia_ace.emotion_with_timecode.v1.EmotionWithTimeCode",
											"id": 1
										},
										"a2e_output": {
											"rule": "repeated",
											"type": "nvidia_ace.emotion_with_timecode.v1.EmotionWithTimeCode",
											"id": 2
										},
										"a2f_smoothed_output": {
											"rule": "repeated",
											"type": "nvidia_ace.emotion_with_timecode.v1.EmotionWithTimeCode",
											"id": 3
										}
									}
								}
							}
						}
					}
				},
				"a2f": {
					"nested": {
						"v1": {
							"nested": {
								"AudioStream": {
									"oneofs": {
										"stream_part": {
											"oneof": [
												"audio_stream_header",
												"audio_with_emotion"
											]
										}
									},
									"fields": {
										"audio_stream_header": {
											"type": "AudioStreamHeader",
											"id": 1
										},
										"audio_with_emotion": {
											"type": "nvidia_ace.a2f.v1.AudioWithEmotion",
											"id": 2
										}
									}
								},
								"AudioStreamHeader": {
									"fields": {
										"animation_ids": {
											"type": "nvidia_ace.animation_id.v1.AnimationIds",
											"id": 1
										},
										"audio_header": {
											"type": "nvidia_ace.audio.v1.AudioHeader",
											"id": 2
										},
										"face_params": {
											"type": "FaceParameters",
											"id": 3
										},
										"emotion_post_processing_params": {
											"type": "EmotionPostProcessingParameters",
											"id": 4
										},
										"blendshape_params": {
											"type": "BlendShapeParameters",
											"id": 5
										},
										"emotion_params": {
											"type": "EmotionParameters",
											"id": 6
										}
									}
								},
								"FloatArray": {
									"fields": {
										"values": {
											"rule": "repeated",
											"type": "float",
											"id": 1
										}
									}
								},
								"FaceParameters": {
									"fields": {
										"float_params": {
											"keyType": "string",
											"type": "float",
											"id": 1
										},
										"integer_params": {
											"keyType": "string",
											"type": "int32",
											"id": 2
										},
										"float_array_params": {
											"keyType": "string",
											"type": "FloatArray",
											"id": 3
										}
									}
								},
								"BlendShapeParameters": {
									"oneofs": {
										"_enable_clamping_bs_weight": {
											"oneof": [
												"enable_clamping_bs_weight"
											]
										}
									},
									"fields": {
										"bs_weight_multipliers": {
											"keyType": "string",
											"type": "float",
											"id": 1
										},
										"bs_weight_offsets": {
											"keyType": "string",
											"type": "float",
											"id": 2
										},
										"enable_clamping_bs_weight": {
											"type": "bool",
											"id": 3,
											"options": {
												"proto3_optional": true
											}
										}
									}
								},
								"EmotionParameters": {
									"oneofs": {
										"_live_transition_time": {
											"oneof": [
												"live_transition_time"
											]
										}
									},
									"fields": {
										"live_transition_time": {
											"type": "float",
											"id": 1,
											"options": {
												"proto3_optional": true
											}
										},
										"beginning_emotion": {
											"keyType": "string",
											"type": "float",
											"id": 2
										}
									}
								},
								"EmotionPostProcessingParameters": {
									"oneofs": {
										"_emotion_contrast": {
											"oneof": [
												"emotion_contrast"
											]
										},
										"_live_blend_coef": {
											"oneof": [
												"live_blend_coef"
											]
										},
										"_enable_preferred_emotion": {
											"oneof": [
												"enable_preferred_emotion"
											]
										},
										"_preferred_emotion_strength": {
											"oneof": [
												"preferred_emotion_strength"
											]
										},
										"_emotion_strength": {
											"oneof": [
												"emotion_strength"
											]
										},
										"_max_emotions": {
											"oneof": [
												"max_emotions"
											]
										}
									},
									"fields": {
										"emotion_contrast": {
											"type": "float",
											"id": 1,
											"options": {
												"proto3_optional": true
											}
										},
										"live_blend_coef": {
											"type": "float",
											"id": 2,
											"options": {
												"proto3_optional": true
											}
										},
										"enable_preferred_emotion": {
											"type": "bool",
											"id": 3,
											"options": {
												"proto3_optional": true
											}
										},
										"preferred_emotion_strength": {
											"type": "float",
											"id": 4,
											"options": {
												"proto3_optional": true
											}
										},
										"emotion_strength": {
											"type": "float",
											"id": 5,
											"options": {
												"proto3_optional": true
											}
										},
										"max_emotions": {
											"type": "int32",
											"id": 6,
											"options": {
												"proto3_optional": true
											}
										}
									}
								},
								"AudioWithEmotion": {
									"fields": {
										"audio_buffer": {
											"type": "bytes",
											"id": 1
										},
										"emotions": {
											"rule": "repeated",
											"type": "nvidia_ace.emotion_with_timecode.v1.EmotionWithTimeCode",
											"id": 2
										}
									}
								}
							}
						}
					}
				},
				"animation_data": {
					"nested": {
						"v1": {
							"nested": {
								"AnimationDataStreamHeader": {
									"oneofs": {
										"_source_service_id": {
											"oneof": [
												"source_service_id"
											]
										},
										"_audio_header": {
											"oneof": [
												"audio_header"
											]
										},
										"_skel_animation_header": {
											"oneof": [
												"skel_animation_header"
											]
										}
									},
									"fields": {
										"animation_ids": {
											"type": "nvidia_ace.animation_id.v1.AnimationIds",
											"id": 1
										},
										"source_service_id": {
											"type": "string",
											"id": 2,
											"options": {
												"proto3_optional": true
											}
										},
										"audio_header": {
											"type": "nvidia_ace.audio.v1.AudioHeader",
											"id": 3,
											"options": {
												"proto3_optional": true
											}
										},
										"skel_animation_header": {
											"type": "nvidia_ace.animation_data.v1.SkelAnimationHeader",
											"id": 4,
											"options": {
												"proto3_optional": true
											}
										},
										"start_time_code_since_epoch": {
											"type": "double",
											"id": 5
										}
									}
								},
								"AnimationDataStream": {
									"oneofs": {
										"stream_part": {
											"oneof": [
												"animation_data_stream_header",
												"animation_data",
												"status"
											]
										}
									},
									"fields": {
										"animation_data_stream_header": {
											"type": "AnimationDataStreamHeader",
											"id": 1
										},
										"animation_data": {
											"type": "nvidia_ace.animation_data.v1.AnimationData",
											"id": 2
										},
										"status": {
											"type": "nvidia_ace.status.v1.Status",
											"id": 3
										}
									}
								},
								"AnimationData": {
									"oneofs": {
										"_skel_animation": {
											"oneof": [
												"skel_animation"
											]
										},
										"_audio": {
											"oneof": [
												"audio"
											]
										},
										"_camera": {
											"oneof": [
												"camera"
											]
										}
									},
									"fields": {
										"skel_animation": {
											"type": "SkelAnimation",
											"id": 1,
											"options": {
												"proto3_optional": true
											}
										},
										"audio": {
											"type": "AudioWithTimeCode",
											"id": 2,
											"options": {
												"proto3_optional": true
											}
										},
										"camera": {
											"type": "Camera",
											"id": 3,
											"options": {
												"proto3_optional": true
											}
										},
										"metadata": {
											"keyType": "string",
											"type": "google.protobuf.Any",
											"id": 4
										}
									}
								},
								"AudioWithTimeCode": {
									"fields": {
										"time_code": {
											"type": "double",
											"id": 1
										},
										"audio_buffer": {
											"type": "bytes",
											"id": 2
										}
									}
								},
								"SkelAnimationHeader": {
									"fields": {
										"blend_shapes": {
											"rule": "repeated",
											"type": "string",
											"id": 1
										},
										"joints": {
											"rule": "repeated",
											"type": "string",
											"id": 2
										}
									}
								},
								"SkelAnimation": {
									"fields": {
										"blend_shape_weights": {
											"rule": "repeated",
											"type": "FloatArrayWithTimeCode",
											"id": 1
										},
										"translations": {
											"rule": "repeated",
											"type": "Float3ArrayWithTimeCode",
											"id": 2
										},
										"rotations": {
											"rule": "repeated",
											"type": "QuatFArrayWithTimeCode",
											"id": 3
										},
										"scales": {
											"rule": "repeated",
											"type": "Float3ArrayWithTimeCode",
											"id": 4
										}
									}
								},
								"Camera": {
									"fields": {
										"position": {
											"rule": "repeated",
											"type": "Float3WithTimeCode",
											"id": 1
										},
										"rotation": {
											"rule": "repeated",
											"type": "QuatFWithTimeCode",
											"id": 2
										},
										"focal_length": {
											"rule": "repeated",
											"type": "FloatWithTimeCode",
											"id": 3
										},
										"focus_distance": {
											"rule": "repeated",
											"type": "FloatWithTimeCode",
											"id": 4
										}
									}
								},
								"FloatArrayWithTimeCode": {
									"fields": {
										"time_code": {
											"type": "double",
											"id": 1
										},
										"values": {
											"rule": "repeated",
											"type": "float",
											"id": 2
										}
									}
								},
								"Float3ArrayWithTimeCode": {
									"fields": {
										"time_code": {
											"type": "double",
											"id": 1
										},
										"values": {
											"rule": "repeated",
											"type": "Float3",
											"id": 2
										}
									}
								},
								"QuatFArrayWithTimeCode": {
									"fields": {
										"time_code": {
											"type": "double",
											"id": 1
										},
										"values": {
											"rule": "repeated",
											"type": "QuatF",
											"id": 2
										}
									}
								},
								"Float3WithTimeCode": {
									"fields": {
										"time_code": {
											"type": "double",
											"id": 1
										},
										"value": {
											"type": "Float3",
											"id": 2
										}
									}
								},
								"QuatFWithTimeCode": {
									"fields": {
										"time_code": {
											"type": "double",
											"id": 1
										},
										"value": {
											"type": "QuatF",
											"id": 2
										}
									}
								},
								"FloatWithTimeCode": {
									"fields": {
										"time_code": {
											"type": "double",
											"id": 1
										},
										"value": {
											"type": "float",
											"id": 2
										}
									}
								},
								"QuatF": {
									"fields": {
										"real": {
											"type": "float",
											"id": 1
										},
										"i": {
											"type": "float",
											"id": 2
										},
										"j": {
											"type": "float",
											"id": 3
										},
										"k": {
											"type": "float",
											"id": 4
										}
									}
								},
								"Float3": {
									"fields": {
										"x": {
											"type": "float",
											"id": 1
										},
										"y": {
											"type": "float",
											"id": 2
										},
										"z": {
											"type": "float",
											"id": 3
										}
									}
								}
							}
						}
					}
				},
				"controller": {
					"nested": {
						"v1": {
							"nested": {
								"AudioStream": {
									"oneofs": {
										"stream_part": {
											"oneof": [
												"audio_stream_header",
												"audio_with_emotion",
												"end_of_audio"
											]
										}
									},
									"fields": {
										"audio_stream_header": {
											"type": "AudioStreamHeader",
											"id": 1
										},
										"audio_with_emotion": {
											"type": "nvidia_ace.a2f.v1.AudioWithEmotion",
											"id": 2
										},
										"end_of_audio": {
											"type": "EndOfAudio",
											"id": 3
										}
									},
									"nested": {
										"EndOfAudio": {
											"fields": {}
										}
									}
								},
								"AudioStreamHeader": {
									"fields": {
										"audio_header": {
											"type": "nvidia_ace.audio.v1.AudioHeader",
											"id": 1
										},
										"face_params": {
											"type": "nvidia_ace.a2f.v1.FaceParameters",
											"id": 2
										},
										"emotion_post_processing_params": {
											"type": "nvidia_ace.a2f.v1.EmotionPostProcessingParameters",
											"id": 3
										},
										"blendshape_params": {
											"type": "nvidia_ace.a2f.v1.BlendShapeParameters",
											"id": 4
										},
										"emotion_params": {
											"type": "nvidia_ace.a2f.v1.EmotionParameters",
											"id": 5
										}
									}
								},
								"EventType": {
									"values": {
										"END_OF_A2F_AUDIO_PROCESSING": 0
									}
								},
								"Event": {
									"oneofs": {
										"_metadata": {
											"oneof": [
												"metadata"
											]
										}
									},
									"fields": {
										"event_type": {
											"type": "EventType",
											"id": 1
										},
										"metadata": {
											"type": "google.protobuf.Any",
											"id": 2,
											"options": {
												"proto3_optional": true
											}
										}
									}
								},
								"AnimationDataStreamHeader": {
									"oneofs": {
										"_audio_header": {
											"oneof": [
												"audio_header"
											]
										},
										"_skel_animation_header": {
											"oneof": [
												"skel_animation_header"
											]
										}
									},
									"fields": {
										"audio_header": {
											"type": "nvidia_ace.audio.v1.AudioHeader",
											"id": 1,
											"options": {
												"proto3_optional": true
											}
										},
										"skel_animation_header": {
											"type": "nvidia_ace.animation_data.v1.SkelAnimationHeader",
											"id": 2,
											"options": {
												"proto3_optional": true
											}
										},
										"start_time_code_since_epoch": {
											"type": "double",
											"id": 3
										}
									}
								},
								"AnimationDataStream": {
									"oneofs": {
										"stream_part": {
											"oneof": [
												"animation_data_stream_header",
												"animation_data",
												"event",
												"status"
											]
										}
									},
									"fields": {
										"animation_data_stream_header": {
											"type": "AnimationDataStreamHeader",
											"id": 1
										},
										"animation_data": {
											"type": "nvidia_ace.animation_data.v1.AnimationData",
											"id": 2
										},
										"event": {
											"type": "Event",
											"id": 3
										},
										"status": {
											"type": "nvidia_ace.status.v1.Status",
											"id": 4
										}
									}
								}
							}
						}
					}
				},
				"services": {
					"nested": {
						"a2f_controller": {
							"nested": {
								"v1": {
									"nested": {
										"A2FControllerService": {
											"methods": {
												"ProcessAudioStream": {
													"requestType": "nvidia_ace.controller.v1.AudioStream",
													"requestStream": true,
													"responseType": "nvidia_ace.controller.v1.AnimationDataStream",
													"responseStream": true
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
		}
	}
};
