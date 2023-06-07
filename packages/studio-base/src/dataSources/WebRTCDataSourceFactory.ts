// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import WebRTCPlayer from "@foxglove/studio-base/players/WebRTCPlayer";
import { Player } from "@foxglove/studio-base/players/types";

export default class WebRTCDataSourceFactory implements IDataSourceFactory {
  public id = "webrtc";
  public type: IDataSourceFactory["type"] = "connection";
  public displayName = "WebRTC Connection";
  public iconName: IDataSourceFactory["iconName"] = "Flow";
  public description =
    "Connect to a ROS 1, ROS 2, or custom system over a WebRTC connection.";
  public docsLinks = [{ url:
    "https://transitiverobotics.com/caps/transitive-robotics/foxglove-webrtc/"
  }];

  public formConfig = {
    fields: [{
      id: "url",
      label: "Transitive Robotics device URL",
      defaultValue: "https://portal.transitiverobotics.com/running/@transitive-robotics/foxglove-webrtc/dist/foxglove-webrtc-device.js?userId=USERID&deviceId=DEVICEID",
      validate: (newValue: string): Error | undefined => {
        try {
          const url = new URL(newValue);
          if (url.protocol !== "http:" && url.protocol !== "https:") {
            return new Error(`Invalid protocol: ${url.protocol}`);
          }
          return undefined;
        } catch (err) {
          return new Error("Enter a valid url");
        }
      },
    }],
  };

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    if (!args.params?.url || !args.params?.jwt) {
      return;
    }

    return new WebRTCPlayer({
      url: args.params.url,
      jwt: args.params.jwt,
      device: args.params.device,
      ...args.params
    });
  }
}
