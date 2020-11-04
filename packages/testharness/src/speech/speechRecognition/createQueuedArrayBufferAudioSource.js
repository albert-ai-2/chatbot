import { AudioStreamFormat } from '../../external/microsoft-cognitiveservices-speech-sdk';

import {
  AudioSourceErrorEvent,
  AudioSourceInitializingEvent,
  AudioSourceOffEvent,
  AudioSourceReadyEvent,
  AudioStreamNodeAttachedEvent,
  AudioStreamNodeAttachingEvent,
  AudioStreamNodeDetachedEvent
} from '../../external/microsoft-cognitiveservices-speech-sdk/distrib/lib/src/common/AudioSourceEvents';

import { createNoDashGuid } from '../../external/microsoft-cognitiveservices-speech-sdk/distrib/lib/src/common/Guid';
import { Events } from '../../external/microsoft-cognitiveservices-speech-sdk/distrib/lib/src/common/Events';
import { EventSource } from '../../external/microsoft-cognitiveservices-speech-sdk/distrib/lib/src/common/EventSource';
import { PromiseHelper } from '../../external/microsoft-cognitiveservices-speech-sdk/distrib/lib/src/common/Promise';
import { Stream } from '../../external/microsoft-cognitiveservices-speech-sdk/distrib/lib/src/common/Stream';

const CHUNK_SIZE = 4096;

class QueuedArrayBufferAudioSource {
  constructor(audioFormat, audioSourceId = createNoDashGuid()) {
    this._audioFormat = audioFormat;
    this._queue = [];
    this._id = audioSourceId;
    this._streams = {};

    this.onEvent = event => {
      this._events.onEvent(event);
      Events.instance.onEvent(event);
    };

    this._events = new EventSource();
  }

  push = arrayBuffer => {
    // 10 seconds of audio in bytes =
    // sample rate (bytes/second) * 600 (seconds) + 44 (size of the wave header).
    const maxSize = this._audioFormat.samplesPerSec * 600 + 44;

    if (arrayBuffer.length > maxSize) {
      const errorMsg = `ArrayBuffer exceeds the maximum allowed file size (${maxSize}).`;

      this.onEvent(new AudioSourceErrorEvent(errorMsg, ''));

      return PromiseHelper.fromError(errorMsg);
    }

    this._queue.push(arrayBuffer);
  };

  turnOn = () => {
    this.onEvent(new AudioSourceInitializingEvent(this._id)); // no stream id
    this.onEvent(new AudioSourceReadyEvent(this._id));

    return PromiseHelper.fromResult(true);
  };

  id = () => this._id;

  // Returns an IAudioSourceNode asynchronously.
  // Reference at node_modules/microsoft-cognitiveservices-speech-sdk/distrib/es2015/src/common/IAudioSource.d.ts
  attach = audioNodeId => {
    this.onEvent(new AudioStreamNodeAttachingEvent(this._id, audioNodeId));

    return this.upload(audioNodeId).onSuccessContinueWith(stream => {
      this.onEvent(new AudioStreamNodeAttachedEvent(this._id, audioNodeId));

      return {
        detach: () => {
          delete this._streams[audioNodeId];

          this.onEvent(new AudioStreamNodeDetachedEvent(this._id, audioNodeId));
          this.turnOff();
        },
        id: () => audioNodeId,
        read: stream.read.bind(stream)
      };
    });
  };

  detach = audioNodeId => {
    if (audioNodeId && this._streams[audioNodeId]) {
      this._streams[audioNodeId].close();

      delete this._streams[audioNodeId];

      this.onEvent(new AudioStreamNodeDetachedEvent(this._id, audioNodeId));
    }
  };

  turnOff = () => {
    Object.values(this._streams).forEach(stream => stream && !stream.isClosed && stream.close());

    this.onEvent(new AudioSourceOffEvent(this._id)); // no stream now

    return PromiseHelper.fromResult(true);
  };

  // Creates a new Stream object merge all chunks from _queue into a single IAudioStreamNode
  upload = audioNodeId => {
    return this.turnOn().onSuccessContinueWith(() => {
      const stream = new Stream(audioNodeId);

      this._streams[audioNodeId] = stream;

      const arrayBuffer = this._queue.shift();

      const { byteLength } = arrayBuffer;

      for (let i = 0; i < byteLength; i += CHUNK_SIZE) {
        stream.writeStreamChunk({
          buffer: arrayBuffer.slice(i, Math.min(i + CHUNK_SIZE, byteLength)),
          isEnd: false,
          timeReceived: Date.now()
        });
      }

      // Stream will only close the internal stream writer.
      stream.close();

      return stream;
    });
  };

  get format() {
    return PromiseHelper.fromResult(this._audioFormat);
  }

  get events() {
    return this._events;
  }

  get deviceInfo() {
    return PromiseHelper.fromResult({
      bitspersample: this._audioFormat.bitsPerSample,
      channelcount: this._audioFormat.channels,
      connectivity: 'Unknown',
      manufacturer: 'Speech SDK',
      model: 'File',
      samplerate: this._audioFormat.samplesPerSec,
      type: 'File'
    });
  }
}

export default function createQueuedArrayBufferAudioSource(
  audioFormat = AudioStreamFormat.getWaveFormatPCM(16000, 16, 1)
) {
  return new QueuedArrayBufferAudioSource(audioFormat);
}
