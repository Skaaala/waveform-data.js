"use strict";

var WaveformData = require("../../waveform-data");
var previousDataObject = null;

/**
 * This callback is executed once the audio has been decoded by the browser and
 * resampled by waveform-data.
 *
 * @callback onAudioResampled
 * @param {WaveformData} waveform_data Waveform instance of the browser decoded audio
 * @param {AudioBuffer} audio_buffer Decoded audio buffer
 */

/**
 * AudioBuffer-based WaveformData generator
 *
 * Adapted from BlockFile::CalcSummary in Audacity, with permission.
 * @see https://code.google.com/p/audacity/source/browse/audacity-src/trunk/src/BlockFile.cpp
 *
 * @param {Object.<{scale: Number, amplitude_scale: Number}>} options
 * @param {onAudioResampled} callback
 * @returns {Function.<AudioBuffer>}
 */

function roundToWholeByte(value) {
    if (value % 2 !== 0) {
        value++;
    }
    return value;
}

function arrayBufferConcat(first, second) {
    var tmp = new Uint8Array(first.byteLength + second.byteLength);

    tmp.set(new Uint8Array(first), 0);
    tmp.set(new Uint8Array(second), first.byteLength);
    return tmp.buffer;
}

function calculateWaveformDataLength(audio_sample_count, scale) {
    var data_length = Math.floor(audio_sample_count / scale);

    var samples_remaining = audio_sample_count - (data_length * scale);

    if (samples_remaining > 0) {
        data_length++;
    }

    return data_length;
}

function getWholeDataObject(audio_buffer_obj, data_object, amplitude_scale, scale, channels, data_length, buffer_length, offset) {
    var INT8_MAX = 127;
    var INT8_MIN = -128;

    var min_value = Infinity, max_value = -Infinity, scale_counter = 0, sample = 0;

    data_object.setInt32(0, 1, true); // Version
    data_object.setUint32(4, 1, true); // Is 8 bit?
    data_object.setInt32(8, audio_buffer_obj.sampleRate, true); // Sample rate
    data_object.setInt32(12, scale, true); // Scale
    data_object.setInt32(16, data_length, true); // Length

    for (var i = 0; i < buffer_length; i++) {
        sample = 0;

        for (var channel = 0; channel < channels.length; ++channel) {
            sample += channels[channel][i];
        }

        sample = Math.floor(INT8_MAX * sample * amplitude_scale / channels.length);

        if (sample < min_value) {
            min_value = sample;

            if (min_value < INT8_MIN) {
                min_value = INT8_MIN;
            }
        }

        if (sample > max_value) {
            max_value = sample;

            if (max_value > INT8_MAX) {
                max_value = INT8_MAX;
            }
        }

        if (++scale_counter === scale) {
            data_object.setInt8(offset++, Math.floor(min_value));
            data_object.setInt8(offset++, Math.floor(max_value));
            min_value = Infinity;
            max_value = -Infinity;
            scale_counter = 0;
        }
    }

    if (scale_counter > 0) {
        data_object.setInt8(offset++, Math.floor(min_value));
        data_object.setInt8(offset++, Math.floor(max_value));
    }
}

function getPartOfDataObject(audio_buffer_obj, data_object, amplitude_scale, scale, channels, data_length, buffer_length, offset, start, end) {
        var INT8_MAX = 127;
        var INT8_MIN = -128;

        var min_value = Infinity, max_value = -Infinity, scale_counter = 0, sample = 0;

        offset = calculateWaveformDataLength(start * 2, scale);

        for (var i = start; i < end; i++) {
            sample = 0;

            for (var channel = 0; channel < channels.length; ++channel) {
                sample += channels[channel][i];
            }

            sample = Math.floor(INT8_MAX * sample * amplitude_scale / channels.length);

            if (sample < min_value) {
                min_value = sample;

                if (min_value < INT8_MIN) {
                    min_value = INT8_MIN;
                }
            }

            if (sample > max_value) {
                max_value = sample;

                if (max_value > INT8_MAX) {
                    max_value = INT8_MAX;
                }
            }

            if (++scale_counter === scale) {
                data_object.setInt8(offset++, Math.floor(min_value));
                data_object.setInt8(offset++, Math.floor(max_value));
                min_value = Infinity;
                max_value = -Infinity;
                scale_counter = 0;
            }
        }

        if (scale_counter > 0) {
            data_object.setInt8(offset++, Math.floor(min_value));
            data_object.setInt8(offset++, Math.floor(max_value));
        }
    }

function getAudioDecoder(options, callback) {
  return function onAudioDecoded(audio_buffer) {

      var audio_buffer_obj = {
        length: audio_buffer.length,
        sampleRate: audio_buffer.sampleRate,
        channels: []
      };

      // Fill in the channels data.
      for (var channel = 0; channel < audio_buffer.numberOfChannels; ++channel) {
        audio_buffer_obj.channels[channel] = audio_buffer.getChannelData(channel);
      }


      function calculateWaveformDataLength(audio_sample_count, scale) {
        var data_length = Math.floor(audio_sample_count / scale);

        var samples_remaining = audio_sample_count - (data_length * scale);

        if (samples_remaining > 0) {
          data_length++;
        }

        return data_length;
      }

      var scale = options.scale;
      var amplitude_scale = options.amplitude_scale;

      var data_length = calculateWaveformDataLength(audio_buffer.length, scale);
      var header_size = 20;
      var data_object;
      var channels = audio_buffer_obj.channels;
      var buffer_length = audio_buffer_obj.length;
      var offset = header_size;

      // partial update of data_object (DataView)
      var start = options.lastStart;
      var end = options.lastEnd;

      if (start && end) {
          // delete operation
          if (options.isDelete) {
              var previousBuffer = previousDataObject.buffer;

              // need to be value divided by 2 or whole array is broken
              var scaledStart = roundToWholeByte(calculateWaveformDataLength((start * 2), scale) + header_size);
              var scaledEnd = roundToWholeByte(calculateWaveformDataLength((end * 2), scale) + header_size);

              var startPreviousArrayBuffer = previousBuffer.slice(0, scaledStart);
              var endPreviousArrayBuffer = previousBuffer.slice(scaledEnd, previousBuffer.byteLength);
              var concatedArrayBuffer = arrayBufferConcat(startPreviousArrayBuffer, endPreviousArrayBuffer);

              data_object = new DataView(concatedArrayBuffer);
              data_length = (data_object.byteLength / 2) - header_size;

              // update length value (16 offset)
              data_object.setInt32(16, data_length, true); // Length

          }
          // enhance operations (beep, fades, volume)
          else {
              data_object = previousDataObject;
              getPartOfDataObject(audio_buffer_obj, data_object, amplitude_scale, scale, channels, data_length, buffer_length, offset, start, end);
          }
      }
      // first sampling
      else {
          data_object = new DataView(new ArrayBuffer(header_size + data_length * 2));
          getWholeDataObject(audio_buffer_obj, data_object, amplitude_scale, scale, channels, data_length, buffer_length, offset);
      }

      previousDataObject = data_object;

      callback(
          null,
          new WaveformData(data_object.buffer, WaveformData.adapters.arraybuffer),
          audio_buffer
      );
    };
}

module.exports = getAudioDecoder;
