<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import { useVoiceChat } from './useVoiceChat';
import AudioVisualizer from './AudioVisualizer.vue';

const props = withDefaults(defineProps<{
  server: string;
  agent: string;
  room?: string;
  theme?: 'light' | 'dark';
  agentName?: string;
  autoConnect?: boolean;
  pushToTalk?: boolean;
  showTranscript?: boolean;
}>(), {
  theme: 'dark',
  autoConnect: true,
  pushToTalk: false,
  showTranscript: true,
});

const emit = defineEmits<{
  message: [msg: import('@agent-voice-chat/core').Message];
  connect: [];
  disconnect: [];
  error: [err: Error];
}>();

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
} = useVoiceChat({
  server: props.server,
  agent: props.agent,
  room: props.room,
  agentName: props.agentName,
  pushToTalk: props.pushToTalk,
});

const inputText = ref('');
const messagesEnd = ref<HTMLElement | null>(null);

const DARK = {
  bg: '#1a1a2e', surface: '#16213e', text: '#e0e0e0', textMuted: '#8888aa',
  primary: '#3b82f6', border: '#2a2a4a', msgBg: '#1e293b', msgUserBg: '#1e3a5f',
};
const LIGHT = {
  bg: '#ffffff', surface: '#f8fafc', text: '#1e293b', textMuted: '#64748b',
  primary: '#3b82f6', border: '#e2e8f0', msgBg: '#f1f5f9', msgUserBg: '#dbeafe',
};

const colors = computed(() => props.theme === 'dark' ? DARK : LIGHT);

// Emit events
watch(isConnected, (val) => {
  if (val) emit('connect');
  else emit('disconnect');
});
watch(error, (val) => {
  if (val) emit('error', val);
});
watch(() => messages.value.length, () => {
  if (messages.value.length > 0) {
    emit('message', messages.value[messages.value.length - 1]);
  }
  nextTick(() => messagesEnd.value?.scrollIntoView({ behavior: 'smooth' }));
});

// Auto-connect
onMounted(() => {
  if (props.autoConnect) connect();
});

function handleSend() {
  const text = inputText.value.trim();
  if (!text) return;
  sendMessage(text);
  inputText.value = '';
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}
</script>

<template>
  <div
    class="avc-voice-chat"
    :style="{
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      maxWidth: '480px',
      height: '600px',
      borderRadius: '12px',
      overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif',
      fontSize: '14px',
      backgroundColor: colors.bg,
      color: colors.text,
      border: `1px solid ${colors.border}`,
    }"
  >
    <!-- Header -->
    <div
      :style="{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: `1px solid ${colors.border}`,
        backgroundColor: colors.surface,
      }"
    >
      <div :style="{ display: 'flex', alignItems: 'center', gap: '8px' }">
        <div
          :style="{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: isConnected ? '#22c55e' : '#ef4444',
          }"
        />
        <span :style="{ fontWeight: '600' }">{{ agentName || agent }}</span>
        <span v-if="isSpeaking" :style="{ fontSize: '12px', color: colors.primary }">Speaking...</span>
      </div>
      <button
        @click="isConnected ? disconnect() : connect()"
        :style="{
          padding: '4px 12px',
          borderRadius: '6px',
          border: 'none',
          backgroundColor: isConnected ? '#ef4444' : colors.primary,
          color: '#fff',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: '500',
        }"
      >
        {{ isConnected ? 'Disconnect' : 'Connect' }}
      </button>
    </div>

    <!-- Messages -->
    <div
      v-if="showTranscript"
      :style="{
        flex: '1',
        overflowY: 'auto',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }"
    >
      <div
        v-for="msg in messages"
        :key="msg.id"
        :style="{
          padding: '8px 12px',
          borderRadius: '8px',
          backgroundColor: msg.isUser ? colors.msgUserBg : colors.msgBg,
          alignSelf: msg.isUser ? 'flex-end' : 'flex-start',
          maxWidth: '85%',
        }"
      >
        <div :style="{ fontSize: '11px', color: colors.textMuted, marginBottom: '2px' }">{{ msg.name }}</div>
        <div>{{ msg.text }}</div>
      </div>
      <div ref="messagesEnd" />
    </div>

    <!-- Audio visualizer + mic controls -->
    <div
      :style="{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '8px 16px',
        borderTop: `1px solid ${colors.border}`,
        backgroundColor: colors.surface,
      }"
    >
      <button
        @click="isListening ? stopListening() : startListening()"
        :disabled="!isConnected"
        :style="{
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          border: 'none',
          backgroundColor: isListening ? '#ef4444' : colors.primary,
          color: '#fff',
          cursor: isConnected ? 'pointer' : 'not-allowed',
          opacity: isConnected ? 1 : 0.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '18px',
          flexShrink: '0',
        }"
        :title="isListening ? 'Stop microphone' : 'Start microphone'"
      >
        {{ isListening ? '\u23F9' : '\uD83C\uDF99' }}
      </button>
      <AudioVisualizer
        :level="audioLevel"
        :bars="24"
        :height="32"
        :color="colors.primary"
        :inactive-color="colors.border"
      />
    </div>

    <!-- Text input -->
    <div
      :style="{
        display: 'flex',
        gap: '8px',
        padding: '8px 12px',
        borderTop: `1px solid ${colors.border}`,
        backgroundColor: colors.surface,
      }"
    >
      <input
        v-model="inputText"
        type="text"
        placeholder="Type a message..."
        :disabled="!isConnected"
        @keydown="handleKeyDown"
        :style="{
          flex: '1',
          padding: '8px 12px',
          borderRadius: '8px',
          border: `1px solid ${colors.border}`,
          backgroundColor: colors.bg,
          color: colors.text,
          fontSize: '14px',
          outline: 'none',
        }"
      />
      <button
        @click="handleSend"
        :disabled="!isConnected || !inputText.trim()"
        :style="{
          padding: '8px 16px',
          borderRadius: '8px',
          border: 'none',
          backgroundColor: colors.primary,
          color: '#fff',
          cursor: isConnected && inputText.trim() ? 'pointer' : 'not-allowed',
          opacity: isConnected && inputText.trim() ? 1 : 0.5,
          fontSize: '14px',
          fontWeight: '500',
        }"
      >
        Send
      </button>
    </div>
  </div>
</template>


