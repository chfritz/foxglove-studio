// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// import { isEqual, sortBy } from "lodash";
import { v4 as uuidv4 } from "uuid";
import _ from "lodash";

import { debouncePromise } from "@foxglove/den/async";
// import { Sockets } from "@foxglove/electron-socket/renderer";
import Logger from "@foxglove/log";
// import { RosNode, TcpSocket } from "@foxglove/ros1";
// import { RosMsgDefinition } from "@foxglove/rosmsg";
import { Time, fromMillis } from "@foxglove/rostime";
import { ParameterValue } from "@foxglove/studio";
// import OsContextSingleton from "@foxglove/studio-base/OsContextSingleton";
// import PlayerProblemManager from "@foxglove/studio-base/players/PlayerProblemManager";
import {
  AdvertiseOptions,
  MessageEvent,
  Player,
  PlayerCapabilities,
  // PlayerMetricsCollectorInterface,
  PlayerPresence,
  PlayerState,
  // PlayerProblem,
  PublishPayload,
  SubscribePayload,
  Topic,
  TopicStats,
} from "@foxglove/studio-base/players/types";
import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";
import CommonRosTypes from "@foxglove/rosmsg-msgs-common";

// import rosDatatypesToMessageDefinition from "@foxglove/studio-base/util/rosDatatypesToMessageDefinition";
// import { getTopicsByTopicName } from "@foxglove/studio-base/util/selectors";
// import { HttpServer } from "@foxglove/xmlrpc";

const anyWindow: any = window;

/** ensure the named web component is loaded; if not, it is loaded assuming
the .js file it is defined in has the same name as the component itself */
// const ensureWebComponentIsLoaded = (capability, name, userId, deviceId) => {
//   useEffect(() => {
//       if (userId && deviceId && !customElements.get(name)) {
//         const host = 'http://portal.homedesk.local:8000'; // #CHANGE
//         const script = document.createElement('script');
//         const params = `userId=${userId}&deviceId=${deviceId}`;
//         script.setAttribute('src',
//           `${host}/running/${capability}/dist/${name}.js?${params}`);
//         document.head.appendChild(script);
//       }
//     }, [capability, name, userId, deviceId]);
// };
// const ensureWebComponentIsLoaded =
//   (capability: string, name: string, userId: string, deviceId: string): Promise<void> =>
//   new Promise((resolve, reject) => {
//     if (userId && deviceId && !customElements.get(name)) {
//       const host = 'http://portal.homedesk.local:8000'; // #CHANGE
//       const script = document.createElement('script');
//       const params = `userId=${userId}&deviceId=${deviceId}`;
//       script.setAttribute('src',
//         `${host}/running/${capability}/dist/${name}.js?${params}`);
//       document.head.appendChild(script);
//       script.onload = () => {
//         console.log(`${capability} loaded`);
//         resolve();
//       }
//     }
//   });

const ensurePlayerIsLoaded = (url: string): Promise<void> =>
  new Promise((resolve) => {
    if (url && !anyWindow.transitive?.FoxgloveWebrtcPlayer) {
      const script = document.createElement('script');
      script.setAttribute('src', url);
      document.head.appendChild(script);
      script.onload = () => {
        console.log(`${url} loaded`);
        resolve();
      }
    }
  });

/** decode a JWT, i.e., extract and decode the base64 encoded payload object */
const decodeJWT = (jwt: string) => {
  const base64 = jwt.split('.')[1];
  if (!base64) return null;
  return JSON.parse(atob(base64));
};

const log = Logger.getLogger(__filename);
// const rosLog = Logger.getLogger("ROS1");

const CAPABILITIES = [
  PlayerCapabilities.advertise,
  // PlayerCapabilities.getParameters,
  // PlayerCapabilities.setParameters,
];

// enum Problem {
//   Connection = "Connection",
//   Parameters = "Parameters",
//   Graph = "Graph",
//   Publish = "Publish",
//   Node = "Node",
// }

// type Ros1PlayerOpts = {
//   url: string;
//   hostname?: string;
//   metricsCollector: PlayerMetricsCollectorInterface;
//   sourceId: string;
// };

// /** Convert YUV420 (aka. I420) buffer to rgb8.
//  * From https://gist.github.com/ryohey/ee6a4d9a7293d66944b1ef9489807783. */
// function yuv420ProgPlanarToRgb(yuv: any, width: number, height: number) {
//   const frameSize = width * height;
//   const halfWidth = Math.floor(width / 2);
//   const uStart = frameSize;
//   const vStart = frameSize + Math.floor(frameSize / 4);
//   const rgb = [];

//   for (let y = 0; y < height; y++) {
//     for (let x = 0; x < width; x++) {
//       const yy = yuv[y * width + x];
//       const colorIndex = Math.floor(y / 2) * halfWidth + Math.floor(x / 2);
//       const uu = yuv[uStart + colorIndex] - 128;
//       const vv = yuv[vStart + colorIndex] - 128;
//       const r = yy + 1.402 * vv;
//       const g = yy - 0.344 * uu - 0.714 * vv;
//       const b = yy + 1.772 * uu;
//       rgb.push(r, g, b);
//     }
//   }

//   return rgb;
// }

/** unify ros1 and ros2 topic types to `pkg/Type` format, i.e., strip the
 * middle `msgs` from ros 2 types */
const simpleSchemaName = (schemaName: string) : string => {
  const parts = schemaName.split('/');
  return parts.length == 2 ? schemaName : `${parts[0]}/${parts[2]}`;
};

const dataTypeToFullName = (dataType: string): string => {
  const parts = dataType.split("/");
  if (parts.length === 2) {
    return `${parts[0]}/msg/${parts[1]}`;
  }
  return dataType;
}

// Connects to a robot over a webrtc connection negotiated by Transitive Robotics
export default class WebRTCPlayer implements Player {
  private _url: string;
  private _jwt: string;
  private _device: string | undefined;
  private _bitrate: number | undefined;
  private _datarate: number | undefined;
  // private _hostname?: string; // ROS_HOSTNAME
  // private _rosNode?: RosNode; // Our ROS node when we're connected.
  private _id: string = uuidv4(); // Unique ID for this player.
  private _listener?: (arg0: PlayerState) => Promise<void>; // Listener for _emitState().
  // private _closed: boolean = false; // Whether the player has been completely closed using close().
  private _providerTopics?: Topic[]; // Topics as advertised by rosmaster.
  private _providerTopicsStats = new Map<string, TopicStats>(); // topic names to topic statistics.
  private _providerDatatypes: RosDatatypes = new Map(); // All ROS message definitions received from subscriptions and set by publishers.
  // private _publishedTopics = new Map<string, Set<string>>(); // A map of topic names to the set of publisher IDs publishing each topic.
  // private _subscribedTopics = new Map<string, Set<string>>(); // A map of topic names to the set of subscriber IDs subscribed to each topic.
  // private _services = new Map<string, Set<string>>(); // A map of service names to service provider IDs that provide each service.
  private _parameters = new Map<string, ParameterValue>(); // rosparams
  private _start: Time; // The time at which we started playing.
  // private _clockTime?: Time; // The most recent published `/clock` time, if available
  private _requestedPublishers: AdvertiseOptions[] = []; // Requested publishers by setPublishers()
  private _requestedSubscriptions: SubscribePayload[] = []; // Requested subscriptions by setSubscriptions()
  private _parsedMessages: MessageEvent<unknown>[] = []; // Queue of messages that we'll send in next _emitState() call.
  // private _parsedMessages: any[] = []; // Queue of messages that we'll send in next _emitState() call.
  // private _requestTopicsTimeout?: ReturnType<typeof setTimeout>; // setTimeout() handle for _requestTopics().
  // private _hasReceivedMessage = false;
  // private _metricsCollector: PlayerMetricsCollectorInterface;
  // private _presence: PlayerPresence = PlayerPresence.INITIALIZING;
  // private _problems = new PlayerProblemManager();
  // private _emitTimer?: ReturnType<typeof setTimeout>;
  // private readonly _sourceId: string;
  // private _data?: any;
  // private _fullTopic?: string;
  private _sessionTopic?: string;
  private _topicIndex?: any;
  private _foxgloveWebrtcPlayer?: any;
  private _videoTracks?: any[];

//   public constructor({ url, hostname, metricsCollector, sourceId }: Ros1PlayerOpts) {
//     log.info(`initializing Ros1Player (url=${url}, hostname=${hostname})`);
//     this._metricsCollector = metricsCollector;
//     this._url = url;
//     this._hostname = hostname;
//     this._start = this._getCurrentTime();
//     this._metricsCollector.playerConstructed();
//     this._sourceId = sourceId;
//     void this._open();
//   }

  public constructor(
    { url, jwt, device = undefined, bitrate = undefined, datarate = undefined }:
    {url: string, jwt: string, device?: string, bitrate?: number, datarate?: number}) {
    log.info(`initializing WebRTCPlayer url=${url}`);
    this._url = url;
    this._jwt = jwt;
    this._device = device;
    this._bitrate = bitrate; // bitrate in KB/s for video streams
    this._datarate = datarate; // bitrate in KB/s for data connection
    this._start = fromMillis(Date.now());
    this._init();
    this._providerDatatypes = new Map();
    // this._providerDatatypes.set('turtlesim/Pose', {
    //   name: 'turtlesim/Pose',
    //   definitions: [
    //     {name: 'x', type: 'float32'},
    //     {name: 'y', type: 'float32'},
    //     {name: 'theta', type: 'float32'},
    //     {name: 'linear_velocity', type: 'float32'},
    //     {name: 'angular_velocity', type: 'float32'},
    //   ]
    // });
  }

  private _init = async () => {
    const {id, device} = decodeJWT(this._jwt);
    await ensurePlayerIsLoaded(`${this._url}?userId=${id}&deviceId=${device}`);

    anyWindow.webrtcPlayer = this;
    const url = new URL(this._url);
    const host = url.host.replace('portal.', '');
    const ssl = (url.protocol == 'https:');

    const foxgloveWebrtcPlayer = new anyWindow.transitive.FoxgloveWebrtcPlayer();
    this._foxgloveWebrtcPlayer = foxgloveWebrtcPlayer;
    await foxgloveWebrtcPlayer.connect({
      jwt: this._jwt,
      id,
      device: this._device, // optional: overwrite device in JWT (e.g., _fleet)
      host,
      ssl,
      dataRate: this._datarate,
      onTopics: (topics: any) => {
        log.debug('got topics', topics);
        this._topicIndex = _.keyBy(topics, 'name');
        this._providerTopics = _.map(topics, topic => ({
            name: topic.name,
            schemaName: topic.type
            // schemaName: simpleSchemaName(topic.type)
        }));
        this._updateSubscriptions();
        this._updatePublishers();
        this._emitState();
      }
    });

    // ugly side-loading trick, but saves 90% CPU compares to using images!
    anyWindow.playerCap = foxgloveWebrtcPlayer;

    setTimeout(() => {
      log.debug('tracks', foxgloveWebrtcPlayer.tracks);
    }, 4000);

    foxgloveWebrtcPlayer.onData(this._onData.bind(this));

    // log.debug(CommonRosTypes);
    _.forEach(CommonRosTypes.ros2galactic, (dataType) => {
      if (dataType.name) {
        this._providerDatatypes.set(dataType.name, dataType);
        dataType.name = dataTypeToFullName(dataType.name);
        this._providerDatatypes.set(dataType.name, dataType);
      }
    });

    // #DEBUG
    // this._providerDatatypes.set('turtlesim/msg/Pose', {
    //   definitions: [
    //       {name: 'x', type: 'float32', isComplex: false, isArray: false},
    //       {name: 'y', type: 'float32', isComplex: false, isArray: false},
    //       {name: 'theta', type: 'float32', isComplex: false, isArray: false},

    //       {name: 'linear_velocity', type: 'float32', isComplex: false, isArray: false},
    //       {name: 'angular_velocity', type: 'float32', isComplex: false, isArray: false},
    //     ]
    // });
    // log.debug(this._providerDatatypes);

    this._updateSubscriptions();
    this._updatePublishers();
  }


  /** handler when receiving data from webrtc, example data: {
    "type":"ros1message",
    "data":{"/turtle1/pose":{
      "x":6.251485824584961,
      "y":3.2636923789978027,
      "theta":2.1935558319091797,
      "linear_velocity":0,
      "angular_velocity":-1
    }}
  }
  */
  private _onData(json: any) {
    // log.debug('onData', json);
    if (json.type === 'ros1message') {
      _.forEach(json.data, (value, topic) => {
        const receiveTime = fromMillis(Date.now());

        this._parsedMessages.push({
          topic,
          schemaName: this._topicIndex[topic]?.type,
          // schemaName: simpleSchemaName(this._topicIndex[topic].schemaName),
          receiveTime,
          message: value,
          sizeInBytes: JSON.stringify(value)?.length || 0,
          // - 12 // 12 for type field and value;
          // TODO: make more precise
        });

        // update stats:
        let stats = this._providerTopicsStats.get(topic);
        if (!stats) {
          stats = {
            firstMessageTime: receiveTime,
            numMessages: 0
          };
          this._providerTopicsStats.set(topic, stats);
        }
        stats.numMessages++;
        stats.lastMessageTime = receiveTime;
      });

    } else if (json.type == 'videobuffer') {
      // console.log('videobuffer', json.buf);

      const receiveTime = fromMillis(Date.now());
      const topic = json.topic;

      this._parsedMessages.push({
        topic,
        schemaName: 'sensor_msgs/Image', // TODO: adapt for ros 2
        receiveTime,
        message: {
          header: {stamp: {sec: 0, nsec: 0}, seq: 0},
          width: json.width,
          height: json.height,
          encoding: 'rgb8',
          is_bigendian: false,
          step: json.width * 3,
          data: Buffer.from(json.buf),
        },
        sizeInBytes: json.buf.length,
      });

      // update stats:
      let stats = this._providerTopicsStats.get(topic);
      if (!stats) {
        stats = {
          firstMessageTime: receiveTime,
          numMessages: 0
        };
        this._providerTopicsStats.set(topic, stats);
      }
      stats.numMessages++;
      stats.lastMessageTime = receiveTime;
    } else {
      log.debug('unknown message type', json);
    }

    this._emitState();
  }


//   // Potentially performance-sensitive; await can be expensive
//   // eslint-disable-next-line @typescript-eslint/promise-function-async
  // private _emitState = () => {
  private _emitState = debouncePromise(() => {
    if (!this._listener) {
      return Promise.resolve();
    }

    const fakeTime2 = fromMillis(Date.now());
    // const fakeMessages = [{
    //     topic: '/myname',
    //     receiveTime: fakeTime2,
    //     message: 'hello world',
    //     sizeInBytes: 'hello world'.length,
    //     schemaName: 'non_std_msgs/Test'
    //   }, {
    //     topic: '/myname',
    //     receiveTime: fakeTime2,
    //     message: this,  // we may be able to send video tracks this way
    //     sizeInBytes: 1000,
    //     schemaName: 'non_std_msgs/Test'
    //   }];

    // log.debug('emitting state', this);

    const messages = this._parsedMessages;
    // const messages = JSON.parse(JSON.stringify(this._parsedMessages || {}) || '{}');
    this._parsedMessages = [];
    const obj: PlayerState = {
      name: 'foxglove-webrtc',
      presence: PlayerPresence.PRESENT,
      progress: {},
      capabilities: CAPABILITIES,
      profile: undefined,
      // profile: 'ros2',
      playerId: this._id,
      problems: [],
      activeData: {
        messages,
        totalBytesReceived: 8,
        startTime: this._start,
        endTime: fakeTime2,
        currentTime: fakeTime2,
        isPlaying: true,
        speed: 1,
        // We don't support seeking, so we need to set this to any fixed value. Just avoid 0 so
        // that we don't accidentally hit falsy checks.
        lastSeekTime: 1,
        topics: this._providerTopics || [],
        // Always copy topic stats since message counts and timestamps are being updated
        topicStats: new Map(this._providerTopicsStats),
        datatypes: this._providerDatatypes,
        // publishedTopics: this._publishedTopics,
        // subscribedTopics: this._subscribedTopics,
        // services: this._services,
        // parameters: this._parameters,
        // videoTracks: this._videoTracks,
        parameters: this._parameters,
        // videoTracks: this._videoTracks,
      }
    };
    return this._listener(obj);
  });

  public setListener(listener: (arg0: PlayerState) => Promise<void>): void {
    this._listener = listener;
    this._emitState();
  }

  public close(): void {
  }

  public setSubscriptions(subscriptions: SubscribePayload[]): void {
    this._requestedSubscriptions = subscriptions;
    console.log('setSubscriptions', subscriptions);
    this._updateSubscriptions();
  }

  private _updateSubscriptions() {
    const subscriptions: any = {};
    const webrtcTracks: any = {};
    this._topicIndex && _.forEach(this._requestedSubscriptions, ({topic}) => {
      log.debug('requesting', topic, this._topicIndex[topic]);
      if (!this._topicIndex[topic]) {
        return;
      }
      const topicObj = this._topicIndex[topic];
      // if (topic.startsWith('webrtc:')) {
        // webrtcTracks[topic.slice('webrtc:'.length)] = 1;
      // if (schemaName.split('/')[1] == 'Image') {
      if (topicObj.type.split('/').at(-1) == 'Image') {
        webrtcTracks[topic] = topicObj;
      } else {
        subscriptions[topic] = topicObj.type;
      }
    });

    if (!this._foxgloveWebrtcPlayer) {
      log.debug('webrtc player not yet initialized');
      return;
    }

    log.debug('_updateSubscriptions', {webrtcTracks, subscriptions});
    this._foxgloveWebrtcPlayer.setSubscriptions(subscriptions);

    const streams: any[] = [];
    Object.keys(webrtcTracks).sort().forEach((topic) => {
      const {rosVersion = 1} = webrtcTracks[topic];
      const type = 'rostopic';
      const value = topic;
      streams.push({videoSource: {type, value, rosVersion}, complete: true});
    });

    this._providerDatatypes = new Map(this._providerDatatypes); // Signal that datatypes changed.
    this._emitState();

    this._foxgloveWebrtcPlayer.setRequest({
        streams,
        bitrate: Number(this._bitrate || 100)
      }, {
      onTrack: (track: any, tracks: any[]) => {
        console.log('onTrack', track, tracks);
        // this._videoTracks = tracks;
        this._emitState();
      }
    });
  }

  public setPublishers(publishers: AdvertiseOptions[]): void {
    this._requestedPublishers = publishers;
    this._updatePublishers();
  }

  private _updatePublishers(): void {
    this._foxgloveWebrtcPlayer.setPublications(this._requestedPublishers);
  }

  public setParameter(key: string, value: ParameterValue): void {
    console.log('setParameter', key, value);
    throw new Error("Setting parameters is not yet supported by this data source");
  }

  public publish({ topic, msg }: PublishPayload): void {
    this._foxgloveWebrtcPlayer.publish({topic, msg});
  }

  public async callService(service: string, request: unknown): Promise<unknown> {
    console.log('callService', service, request);
    throw new Error("Service calls are not supported by this data source");
  }

  // Bunch of unsupported stuff. Just don't do anything for these.
  public setGlobalVariables(...args: any[]): void {
    console.log('setGlobalVariables', ...args);
    // throw new Error("Setting global vars is not yet supported by this data source");
  }
}
