// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

/**
 * WebRTC connection handler for direct audio streaming.
 *
 * This module provides an optional WebRTC upgrade path for lower-latency
 * audio when the server supports it. Falls back to Socket.IO audio transport.
 */
export class WebRTCConnection {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private _connected = false;

  /** Called when remote audio track is received */
  onRemoteTrack?: (stream: MediaStream) => void;
  /** Called when connection state changes */
  onStateChange?: (state: RTCPeerConnectionState) => void;
  /** Called when a data channel message is received */
  onDataMessage?: (data: any) => void;

  get connected(): boolean {
    return this._connected;
  }

  /** Create a peer connection with the given ICE servers */
  async createConnection(iceServers: RTCIceServer[] = []): Promise<RTCPeerConnection> {
    this.pc = new RTCPeerConnection({
      iceServers: iceServers.length > 0 ? iceServers : [
        { urls: 'stun:stun.l.google.com:19302' },
      ],
    });

    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState;
      if (state) {
        this._connected = state === 'connected';
        this.onStateChange?.(state);
      }
    };

    this.pc.ontrack = (event) => {
      this.remoteStream = event.streams[0] || new MediaStream([event.track]);
      this.onRemoteTrack?.(this.remoteStream);
    };

    return this.pc;
  }

  /** Add local media stream to the connection */
  addLocalStream(stream: MediaStream): void {
    if (!this.pc) return;
    this.localStream = stream;
    stream.getTracks().forEach((track) => {
      this.pc!.addTrack(track, stream);
    });
  }

  /** Create an offer and return the SDP */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) throw new Error('No peer connection');
    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
    });
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  /** Set the remote answer SDP */
  async setRemoteAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) throw new Error('No peer connection');
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  /** Add a remote ICE candidate */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc) return;
    await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  /** Create a data channel for signaling */
  createDataChannel(label: string = 'avc-data'): RTCDataChannel | null {
    if (!this.pc) return null;
    this.dataChannel = this.pc.createDataChannel(label);
    this.dataChannel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.onDataMessage?.(data);
      } catch {
        this.onDataMessage?.(event.data);
      }
    };
    return this.dataChannel;
  }

  /** Send data over the data channel */
  sendData(data: any): void {
    if (this.dataChannel?.readyState === 'open') {
      this.dataChannel.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  }

  /** Close and clean up */
  destroy(): void {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this._connected = false;
    this.remoteStream = null;
  }
}


