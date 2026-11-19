// 효과음: 파일 없이 브라우저 소리 합성으로 만듭니다(인터넷 불필요).
(function () {
  'use strict';
  var ctx = null;
  var master = null;
  var volume = 0.8;

  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      // 큰 소리가 찢어지지 않도록 마지막에 눌러 주는 장치(리미터)를 거칩니다.
      var limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6; limiter.knee.value = 6; limiter.ratio.value = 12;
      limiter.attack.value = 0.003; limiter.release.value = 0.2;
      master.connect(limiter);
      limiter.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, start, dur, type, gain) {
    var c = ensure();
    if (!c) return;
    var t0 = c.currentTime + start;
    var o = c.createOscillator();
    var g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.3, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
    return o;
  }

  function noise(start, dur, gain) {
    var c = ensure();
    if (!c) return;
    var len = Math.max(1, Math.floor(c.sampleRate * dur));
    var buf = c.createBuffer(1, len, c.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = c.createBufferSource();
    src.buffer = buf;
    var g = c.createGain();
    g.gain.value = gain || 0.2;
    var f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(c.currentTime + start);
  }

  // ---------- 녹음된 효과음 파일(짜잔) ----------
  var samples = {}; // 이름 -> { buf, gain, offset }
  function loadSample(name, url) {
    try {
      var x = new XMLHttpRequest();
      x.open('GET', url, true);
      x.responseType = 'arraybuffer';
      x.onload = function () {
        var c = ensure();
        if (!c || !x.response) return;
        c.decodeAudioData(x.response, function (buf) {
          // 파일마다 크기가 달라서, 가장 큰 순간을 기준으로 음량을 맞추고 앞쪽 무음은 건너뜁니다.
          var d = buf.getChannelData(0), peak = 0, i;
          for (i = 0; i < d.length; i++) { var a = Math.abs(d[i]); if (a > peak) peak = a; }
          var start = 0;
          for (i = 0; i < d.length; i++) { if (Math.abs(d[i]) > peak * 0.03) { start = i; break; } }
          samples[name] = {
            buf: buf,
            gain: peak > 0 ? Math.min(6, 1 / peak) : 1,
            offset: Math.max(0, start / buf.sampleRate - 0.01),
            peak: peak
          };
        }, function () {});
      };
      x.send();
    } catch (e) { /* 파일을 못 읽으면 합성음으로 대신합니다 */ }
  }
  function playSample(name, boost) {
    var c = ensure();
    var s = samples[name];
    if (!c || !s) return false;
    var src = c.createBufferSource();
    src.buffer = s.buf;
    var g = c.createGain();
    g.gain.value = s.gain * (boost || 1);
    src.connect(g); g.connect(master);
    src.start(0, s.offset);
    return true;
  }

  var sounds = {
    none: function () {},
    // 불빛이 한 칸 움직일 때
    tick: function () { tone(880, 0, 0.05, 'square', 0.07); },
    // 불빛이 멈췄을 때
    stop: function () { tone(660, 0, 0.12, 'triangle', 0.3); tone(990, 0.1, 0.25, 'triangle', 0.3); },
    // 두구두구
    roll: function () {
      for (var i = 0; i < 22; i++) noise(i * 0.06, 0.06, 0.12 + i * 0.012);
    },
    // 종이가 한 단 펼쳐질 때
    flap: function () { noise(0, 0.09, 0.35); tone(1400, 0, 0.05, 'triangle', 0.08); },
    // 쪽지가 튀어나올 때
    whoosh: function () {
      var o = tone(220, 0, 0.35, 'sawtooth', 0.12);
      if (o && ctx) o.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3);
    },
    // 짜잔: 녹음된 효과음을 크게 틉니다. 파일을 못 읽었을 때만 합성음으로 대신합니다.
    tada: function () { if (!playSample('fanfare', 1.4)) sounds.tadaSynth(); },
    tada2: function () { sounds.tada(); },
    tadaSynth: function () {
      [523.25, 659.25, 783.99].forEach(function (f) { tone(f, 0, 0.13, 'sawtooth', 0.11); });
      [659.25, 783.99, 1046.5, 1318.5].forEach(function (f) {
        tone(f, 0.17, 1.0, 'sawtooth', 0.09);
        tone(f, 0.17, 1.1, 'triangle', 0.14);
      });
      tone(130.81, 0.17, 0.9, 'triangle', 0.22);
      noise(0.17, 0.45, 0.1);
    },
    fanfare: function () {
      var n = [523.25, 659.25, 783.99, 1046.5];
      n.forEach(function (f, i) { tone(f, i * 0.13, 0.22, 'square', 0.16); tone(f / 2, i * 0.13, 0.22, 'triangle', 0.2); });
      [1046.5, 1318.5, 1568].forEach(function (f) { tone(f, 0.55, 0.9, 'triangle', 0.18); });
      noise(0.55, 0.5, 0.1);
    },
    ding: function () { tone(1046.5, 0, 0.35, 'sine', 0.35); tone(1318.5, 0.16, 0.6, 'sine', 0.35); },
    pop: function () {
      var o = tone(420, 0, 0.5, 'sawtooth', 0.2);
      if (o && ctx) o.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.45);
    }
  };

  loadSample('fanfare', 'assets/fanfare.mp3');

  window.Sound = {
    // 점검용: 읽어 둔 효과음 파일 정보
    sampleInfo: function () {
      var out = {};
      Object.keys(samples).forEach(function (k) {
        out[k] = { seconds: samples[k].buf.duration, peak: samples[k].peak, gain: samples[k].gain, offset: samples[k].offset };
      });
      return out;
    },
    // 관리자 화면의 효과음 선택 목록
    choices: [
      { id: 'tada', label: '축하 음악' },
      { id: 'fanfare', label: '팡파르' },
      { id: 'ding', label: '딩동' },
      { id: 'pop', label: '뿅' },
      { id: 'none', label: '무음' }
    ],
    setVolume: function (percent) {
      volume = Math.max(0, Math.min(1, percent / 100));
      if (master) master.gain.value = volume;
    },
    play: function (name) {
      try { (sounds[name] || sounds.none)(); } catch (e) { /* 소리 실패는 진행에 영향 없게 */ }
    }
  };
})();
