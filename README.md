
<p align="center">

<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>

# Homebridge BoM FTP Temperature Plugin

The plugin will present a temperature sensor for each configured location showing the forecast maximum temperature for the current day. The forecast maximum temperature is extracted from Australian Bureau of Meteorology files and updated each morning after the next-routine-issue-time contained in the previously downloaded forecast.

Please note the content of the BoM files change during the day. Those issued early in the day contain the forecast maximum temperature for the current day, while those issued later in the day do not.

If the temperature sensor is initialised while the BoM file does not contain the forecast maximum temperature for the current day, then the sensor will show zero degrees until it is updated the following morning.

# Installation

This plugin requires [Homebridge](https://homebridge.io) (version 1.3.5 or above).

It is recommended that you use [Homebridge Config UI X](https://www.npmjs.com/package/homebridge-config-ui-x) to install Homebridge and configure this plugin. Alternatively you can install this plugin from the command line:

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
                },
                {
                    "label": "...",
                    "bomproductid": "..."
                }
            ],
            "platform": "Homebridge BoM FTP Temperature"
        }
        ...
    ]
```

Platform parameters:
- `delayminutes` is the number of minutes `0-59` to wait after the next-routine-issue-time before starting the FTP download. The BoM FTP site is busy around the exact issue time so a short delay avoids the rush.

Location parameters:
Multiple locations can be included. Each location will present a temperature sensor.
- `label` is the BoM Location name or the name you wish to apply to the temperature sensor.
- `bomproductid` is the Product ID of the forecast found at [BoM FTP Public Products]( http://www.bom.gov.au/catalogue/anon-ftp.shtml) The allowed entries begin with IDD, IDN, IDQ, IDS, IDT, IDV, or IDW. The format is strictly 3 CAPS, 5 digits, no spaces. Any locations using an invalid format are ignored. Any locations that duplicate an existing Product ID are ignored.

## Caveats

Not all BoM forecast files contain a forecast maximum temperature.

For BoM files containing forecasts for multiple days this will only present info for the current day.

For BoM files containing several locations this will first search using the config label. If a matching location is found in the file this will present info for that location. If a matching location is not found this will present info for the first location in the file.

Changes to the config do not apply to existing locations. Changing the label on a location could be performed by changing the config, and using [Homebridge Config UI X](https://www.npmjs.com/package/homebridge-config-ui-x) to remove the cached accessory and restart the server.

Not all forecast files have been tested, so it is possible/probable that the internal structure of some files may require further work.

# Debugging and Testing

If using [Homebridge Config UI X](https://www.npmjs.com/package/homebridge-config-ui-x) to install and manage the Homebridge Service then debug mode can be managed through the GUI (3 dots at upper right of screen).

Otherwise please refer to [Homebridge Basic Troubleshooting](https://github.com/homebridge/homebridge/wiki/Basic-Troubleshooting) from the [Homebridge Wiki](https://github.com/homebridge/homebridge/wiki) for how to start in debug mode and find log files.

The debug output of this plugin includes extracts of the BoM forecast file where the plugin is expecting to find information.
