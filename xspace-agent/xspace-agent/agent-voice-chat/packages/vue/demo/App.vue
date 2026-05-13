<script setup lang="ts">
import { ref } from 'vue';
import { VoiceChat, AudioVisualizer, useVoiceChat } from '@agent-voice-chat/vue';

// Hook demo state
const {
  connect,
  disconnect,
  sendMessage,
  startListening,
  stopListening,
  isConnected,
  isListening,
  isSpeaking,
  audioLevel,
  messages,
  error,
} = useVoiceChat({ server: 'http://localhost:3000', agent: 'bob' });

const text = ref('');

function handleSend() {
  if (!text.value.trim()) return;
  sendMessage(text.value);
  text.value = '';
}
</script>

<template>
  <h1>@agent-voice-chat/vue Demo</h1>

  <div class="demo-grid">
    <div>
      <h2>Drop-in Component</h2>
      <VoiceChat
        server="http://localhost:3000"
        agent="bob"
        theme="dark"
        :auto-connect="false"
        @message="(msg) => console.log('[DropIn] message:', msg)"
        @connect="() => console.log('[DropIn] connected')"
        @disconnect="() => console.log('[DropIn] disconnected')"
      />
    </div>

    <div>
      <h2>Custom Composable</h2>
      <div style="max-width: 480px; padding: 20px; border-radius: 12px; background: #16213e; border: 1px solid #2a2a4a;">
        <h3 style="margin-bottom: 12px;">Custom Composable UI</h3>

        <div style="display: flex; gap: 8px; margin-bottom: 16px;">
          <button
            @click="isConnected ? disconnect() : connect()"
            :style="{
              padding: '8px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer',
              backgroundColor: isConnected ? '#ef4444' : '#3b82f6', color: '#fff',
            }"
          >
            {{ isConnected ? 'Disconnect' : 'Connect' }}
          </button>
          <button
            @click="isListening ? stopListening() : startListening()"
            :disabled="!isConnected"
            :style="{
              padding: '8px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer',
              backgroundColor: isListening ? '#ef4444' : '#22c55e', color: '#fff',
              opacity: isConnected ? 1 : 0.4,
            }"
          >
            {{ isListening ? 'Stop Mic' : 'Start Mic' }}
          </button>
        </div>

        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
          <span style="font-size: 12px; color: #8888aa;">Audio:</span>
          <AudioVisualizer :level="audioLevel" :bars="30" :height="24" color="#3b82f6" inactive-color="#2a2a4a" />
        </div>

        <div style="display: flex; gap: 8px; margin-bottom: 16px;">
          <input
            v-model="text"
            @keydown.enter="handleSend"
            placeholder="Send a message..."
            :disabled="!isConnected"
            style="flex: 1; padding: 8px 12px; border-radius: 8px; border: 1px solid #2a2a4a; background: #1a1a2e; color: #e0e0e0; font-size: 14px; outline: none;"
          />
          <button
            @click="handleSend"
            :disabled="!isConnected || !text.trim()"
            style="padding: 8px 16px; border-radius: 8px; border: none; background: #3b82f6; color: #fff; cursor: pointer;"
          >
            Send
          </button>
        </div>

        <div style="font-size: 12px; color: #8888aa; margin-bottom: 8px;">
          Status: {{ isConnected ? 'Connected' : 'Disconnected' }}
          <span v-if="isSpeaking"> | Speaking</span>
          <span v-if="isListening"> | Listening</span>
          <span v-if="error"> | Error: {{ error.message }}</span>
        </div>

        <div style="max-height: 200px; overflow-y: auto;">
          <div
            v-for="m in messages"
            :key="m.id"
            :style="{
              padding: '6px 10px', marginBottom: '4px', borderRadius: '6px',
              backgroundColor: m.isUser ? '#1e3a5f' : '#1e293b', fontSize: '13px',
            }"
          >
            <strong>{{ m.name }}:</strong> {{ m.text }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>


