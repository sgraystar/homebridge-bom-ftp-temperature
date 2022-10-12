
<p align="center">

<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>

# Homebridge BoM FTP Temperature Plugin

The plugin will present a temperature sensor showing the forecast maximum temperature for the current day, at each configured location. The forecast maximum temperature is updated after the next-routine-issue-time contained in the downloaded forecast.

Please note the content of BoM files change during the day. Those issued early in the day contain the forecast maximum temperature for the current day, while those issued later in the day do not.
If you are adding a location later in the day the sensor will show a forecast temperature of zero degrees until the following day.

# Installation

This plugin requires [Homebridge](https://homebridge.io) (version 1.3.5 or above).

It is highly recommended that you use [Homebridge Config UI X](https://www.npmjs.com/package/homebridge-config-ui-x) to install Homebridge and configure this plugin. Alternatively you can install from the command line:

```
npm install -g homebridge-bom-ftp-temperature
```

Once installed the configuration of this plugin can be managed using [Homebridge Config UI X](https://www.npmjs.com/package/homebridge-config-ui-x) or by following the example config.


## Example Configuration

```
    "platforms": [
        ...
        {
            "name": "BoM FTP Temperature",
            "delayminutes": 7,
            "locations": [
                {
                    "label": "Melbourne",
                    "bomproductid": "IDV10450"
                }
            ],
            "platform": "Homebridge BoM FTP Temperature"
        }
        ...
    ]
```

- `delayminutes` is the number of minutes `0-59` to wait after the BoM next-routine-issue-time before starting the FTP download. The BoM FTP site is busy around the exact issue time so a short delay avoids the rush.

- Any number of locations can be included. 
- `label` is any name you wish to apply to the temperature sensor.
- `bomproductid` is the Product ID of the forecast found at [BoM FTP Public Products]( http://www.bom.gov.au/catalogue/anon-ftp.shtml) The format is strictly 3 CAPS, 5 digits, no spaces. Any locations using an invalid format are ignored. Any locations that duplicate an existing Product ID are ignored.

## Caveats

Not all forecast files have been tested for compatibility, so it is possible/probable that the format of some files will require further work.

# Debugging and Testing

This plugins incorporates debug output that is not normally visible on the [homebridge](https://github.com/nfarina/homebridge) console.
As explained in the [Homebridge troubleshooting documentation](https://github.com/nfarina/homebridge/wiki/Basic-Troubleshooting) you can start [homebridge](https://github.com/nfarina/homebridge) as follows to see debug output:

```
homebridge -D
```

The debug output includes extracts of the BoM forecast file where the plugin is expecting to extract information.
