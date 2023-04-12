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
import { Time, fromMillis, isGreaterThan, toSec } from "@foxglove/rostime";
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
// import rosDatatypesToMessageDefinition from "@foxglove/studio-base/util/rosDatatypesToMessageDefinition";
// import { getTopicsByTopicName } from "@foxglove/studio-base/util/selectors";
// import { HttpServer } from "@foxglove/xmlrpc";

import { useEffect } from 'react';

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
  new Promise((resolve, reject) => {
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
const rosLog = Logger.getLogger("ROS1");

const CAPABILITIES = [
  PlayerCapabilities.advertise,
  PlayerCapabilities.getParameters,
  PlayerCapabilities.setParameters,
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


// Connects to a robot over a webrtc connection negotiated by Transitive Robotics
export default class WebRTCPlayer implements Player {
  private _url: string;
  private _jwt: string;
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
  // private _parameters = new Map<string, ParameterValue>(); // rosparams
  private _start: Time; // The time at which we started playing.
  // private _clockTime?: Time; // The most recent published `/clock` time, if available
  // private _requestedPublishers: AdvertiseOptions[] = []; // Requested publishers by setPublishers()
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
  private _data?: any;
  private _fullTopic?: string;
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

  public constructor({ url, jwt }: {url: string, jwt: string}) {
    log.info(`initializing WebRTCPlayer url=${url}`);
    this._url = url;
    this._jwt = jwt;
    this._start = fromMillis(Date.now());

    this._init();

    this._providerDatatypes = new Map();
    this._providerDatatypes.set('turtlesim/Pose', {
      name: 'turtlesim/Pose',
      definitions: [
        {name: 'x', type: 'float32'},
        {name: 'y', type: 'float32'},
        {name: 'theta', type: 'float32'},
        {name: 'linear_velocity', type: 'float32'},
        {name: 'angular_velocity', type: 'float32'},
      ]
    });
  }

  private _init = async () => {

    // const orgId = 'cfritz';
    // const deviceId = 'f5b1b62bd4';
    const component = 'foxglove-player';
    const {id, device, capability} = decodeJWT(this._jwt);

    // await ensureWebComponentIsLoaded(capability, component, orgId, deviceId);
    await ensurePlayerIsLoaded(`${this._url}?userId=${id}&deviceId=${device}`);

    anyWindow.webrtcPlayer = this;

    const foxgloveWebrtcPlayer = new anyWindow.transitive.FoxgloveWebrtcPlayer();
    this._foxgloveWebrtcPlayer = foxgloveWebrtcPlayer;
    await foxgloveWebrtcPlayer.connect({
      jwt: this._jwt,
      id,
      host: 'homedesk.local:8000',   // #TODO
      ssl: false  // #TODO
    });
    const sessionId = foxgloveWebrtcPlayer.sessionId;
    log.debug('sessionId:', sessionId);
    anyWindow.playerCap = foxgloveWebrtcPlayer;

    setTimeout(() => {
      log.debug('tracks', foxgloveWebrtcPlayer.tracks);
    }, 4000);

    this._fullTopic = ['', // for initial slash
        id, device, capability, anyWindow.transitive.version
      ].join('/');
    this._sessionTopic = `${this._fullTopic}/${sessionId}`;

    foxgloveWebrtcPlayer.onData((data: any) => {
      /** example data: {
       "type":"ros1message",
        "data":{"/turtle1/pose":{
          "x":6.251485824584961,
          "y":3.2636923789978027,
          "theta":2.1935558319091797,
          "linear_velocity":0,
          "angular_velocity":-1
      }}}
      */
      log.debug('got data', data);
      const json = JSON.parse(data);
      if (json.type === 'ros1message') {
        _.forEach(json.data, (value, topic) => {
          const receiveTime = fromMillis(Date.now());

          this._parsedMessages.push({
            topic,
            schemaName: this._topicIndex[topic].schemaName,
            receiveTime,
            message: value,
            sizeInBytes: data.length - 12 // 12 for type field and value;
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
        this._emitState();
      }
    });

    const mqttSync = foxgloveWebrtcPlayer.mqttSync;

    mqttSync.subscribe(`${this._fullTopic}/all/robot/#`);
    mqttSync.subscribe(`${this._sessionTopic}/robot/#`);
    mqttSync.publish(`${this._sessionTopic}/client/#`);

    mqttSync.data.subscribePath(`${this._fullTopic}/all/robot/topics`,
      (topics: any, key: string, matched: any) => {
        log.debug('got topics', topics);

        this._providerTopics = _.map(topics, topic => ({
            name: topic.name,
            schemaName: topic.type
        }));
        this._topicIndex = _.keyBy(this._providerTopics, 'name');

        this._emitState();
      });

    this._data = mqttSync.data;
    this._updateSubscriptions();
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

    log.debug('emitting state', this);

    const messages = this._parsedMessages;
    this._parsedMessages = [];
    return this._listener({
      name: 'foxglove-webrtc',
      presence: PlayerPresence.PRESENT,
      progress: {},
      capabilities: CAPABILITIES,
      profile: undefined,
      // profile: "ros1",
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
      }
    });

  });

  public setListener(listener: (arg0: PlayerState) => Promise<void>): void {
    this._listener = listener;
    this._emitState();
  }

  public close(): void {
  }

  public setSubscriptions(subscriptions: SubscribePayload[]): void {
    this._requestedSubscriptions = subscriptions;
    log.debug('setSubscriptions', subscriptions);
    this._updateSubscriptions();
  }

  private _updateSubscriptions() {
    const subscriptions: any = {};
    const webrtcTracks: any = {};
    _.forEach(this._requestedSubscriptions, ({topic}) => {
      if (topic.startsWith('webrtc:')) {
        webrtcTracks[topic.slice('webrtc:'.length)] = 1;
      } else {
        subscriptions[topic] = 1;
      }
    });

    log.debug('_updateSubscriptions', subscriptions);
    this._data?.update(`${this._sessionTopic}/client/subscriptions`,
      subscriptions);

    if (!this._foxgloveWebrtcPlayer) {
      console.log('webrtc player not yet initialized');
      return;
    }

    const streams: any[] = [];
    Object.keys(webrtcTracks).sort().forEach((sourceSpec) => {
      const [type, value] = sourceSpec.split(',');
      if (type && value) {
        streams.push({videoSource: {type, value}, complete: true});
      }
    });

    this._foxgloveWebrtcPlayer.setRequest({ streams }, {
      onTrack: (track: any, tracks: any[]) => {
        console.log('onTrack', track, tracks);
        // this._videoTracks = tracks;
        this._emitState();
      }
    });
  }

  public setPublishers(publishers: AdvertiseOptions[]): void {
//     this._requestedPublishers = publishers;
  }

  public setParameter(key: string, value: ParameterValue): void {
  }

  public publish({ topic, msg }: PublishPayload): void {
  }

  public async callService(service: string, request: unknown): Promise<unknown> {
    // console.log('callService', service, request);
    // return true;
    throw new Error("Service calls are not supported by this data source");
  }

  //   // Bunch of unsupported stuff. Just don't do anything for these.
  public setGlobalVariables(...args: any[]): void {
    //     // no-op
  }
}
