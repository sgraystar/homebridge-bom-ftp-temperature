
<p align="center">

<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>

# Homebridge BoM FTP Temperature Plugin

The plugin will present temperature sensors showing the forecast maximum temperature for the current day, updated each day after the 'next-routine-issue-time' contained in the forecast file.

Please note the content of BoM files change during the day, those issued early in the day contain the forecast maximum temperature for the current day, while those issued later in the day do not.

If the plugin is being initialised later in the day the sensor will show a forecast temperature of zero degrees until the following day.

BoM forecast files are found at http://www.bom.gov.au/catalogue/anon-ftp.shtml

Not all forecast files have been tested for compatibility.
