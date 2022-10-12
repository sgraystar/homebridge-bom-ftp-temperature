import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { BoMForecastPlatform } from './platform';
import ftp = require('basic-ftp');
import { XMLParser } from 'fast-xml-parser';
import os from 'node:os';
import * as fs from 'node:fs';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class BoMForecastAccessory {
  private service: Service;

  constructor(
    private readonly platform: BoMForecastPlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Homebridge')
      .setCharacteristic(this.platform.Characteristic.Model, 'BoM FTP Temperature')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.bomproductid);

    /**
     * get the TemperatureSensor service if it exists, otherwise create a new TemperatureSensor service
     * you can create multiple services for each accessory
     * set the service name, this is what is displayed as the default name on the Home app
     * in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
     * each service must implement at-minimum the "required characteristics" for the given service type
     * see https://developers.homebridge.io/#/service/TemperatureSensor
     */

    const serviceName1 = accessory.context.device.label + ' Today Max';
    const serviceSubtype1 = accessory.context.device.bomproductid + '-max';
    this.service = this.accessory.getService(serviceName1) ||
      this.accessory.addService(this.platform.Service.TemperatureSensor, serviceName1, serviceSubtype1);

    // register handlers for the Get Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getTemp.bind(this));               // GET - bind to the `getTemp` method below

    // Add "temperature sensor" services to the accessory
    const temperatureSensorMaxService = this.accessory.getService(serviceName1) ||
      this.accessory.addService(this.platform.Service.TemperatureSensor, serviceName1, serviceSubtype1);

    /**
     * Download the BoM forecast file, extract forecast temperatures and the next routine issue time, then schedule ongoing
     * updates to the forecast temperature
     */
    const remoteFile = this.accessory.context.device.bomproductid + '.xml';
    const delayMinutes = this.accessory.context.delayMinutes;
    this.scheduleUpdates(remoteFile, delayMinutes, temperatureSensorMaxService);
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   *
   * GET requests should return as fast as possbile. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   *
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.
   *
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  async getTemp(): Promise<CharacteristicValue> {

    let cacheTemp = this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).value;
    if (cacheTemp === null) {
      cacheTemp = -270;
    }
    this.platform.log.debug(this.service.displayName, 'Get CurrentTemperature', cacheTemp);

    return cacheTemp;
  }

  /**
   * Updating characteristics values asynchronously using the `updateCharacteristic` method.
   */
  async scheduleUpdates(remoteFile, delayMinutes, temperatureSensorMaxService) {
    try {
      // Download the BoM file
      const localFile = (os.tmpdir() + '\\' + remoteFile);
      await this.downloadFromBoM(localFile, remoteFile);

      // Parse the xml file
      const bomJson = await this.bomXmlToJson(localFile);
      //this.platform.log.debug('bomJson\n', JSON.stringify(bomJson, null, 2));
      const bomJsonToday = bomJson[1].product[1].forecast[2].area[0];
      this.platform.log.debug(this.service.displayName, 'conditions for today\n', JSON.stringify(bomJsonToday, null, 2));

      /**
       * Extract the forecast maximum temperature and push the new forecast temperature value to HomeKit
       * The air_temperature_maximum for today changes index within forecast_period[], and is not always present
       */

      //if (bomJson[1]?.product[1]?.forecast[2]?.area[0]?.forecast_period[1][':@']['@_type'] === 'air_temperature_maximum') {
      //  const maxTemp = Number(bomJson[1].product[1].forecast[2].area[0].forecast_period[1].element[0].$text);
      //}

      for(const key1 in bomJsonToday) {
        for (const key2 in bomJsonToday[key1]) {
          for (const key3 in bomJsonToday[key1][key2]) {
            for (const key4 in bomJsonToday[key1][key2][key3]) {
              if (bomJsonToday[key1][key2][key3][key4] === 'air_temperature_maximum') {
                const maxTemp = Number(bomJsonToday[key1][key2].element[0].$text);
                temperatureSensorMaxService.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, maxTemp);
                this.platform.log.info(this.service.displayName, 'changed temperature to', maxTemp);
              }
            }
          }
        }
      }

      /**
       * Extract the next routine issue time and schedule the next download
       */
      const nextIssueTime = bomJson[1].product[0].amoc[8].next_routine_issue_time_utc[0].$text;
      this.platform.log.debug(this.service.displayName, 'times for today\n', JSON.stringify(bomJson[1].product[0], null, 2));

      const downloadOffset = delayMinutes * 60 * 1000;
      const d1ms = new Date().getTime();
      const d2ms = new Date(nextIssueTime).getTime();
      const nextDownload = d2ms - d1ms + downloadOffset;
      this.platform.log.debug(this.service.displayName, 'nextDownload =', nextDownload);

      if (temperatureSensorMaxService !== undefined) {
        setTimeout(() => {
          this.scheduleUpdates(remoteFile, delayMinutes, temperatureSensorMaxService);
        }, nextDownload );
      }

    // Download or parse failed, maybe invalid arguments, maybe temporary, try again in 1 hour
    } catch (error) {
      this.platform.log.debug(this.service.displayName, 'scheduleUpdates:', error);
      const nextDownload = 60 * 60 * 1000;

      if (temperatureSensorMaxService !== undefined) {
        setTimeout(() => {
          this.scheduleUpdates(remoteFile, delayMinutes, temperatureSensorMaxService);
        }, nextDownload );
      }
    }

  }

  /**
   * Download the BoM Forecast file
   */
  async downloadFromBoM(dstFile, srcFile) {
    const client = new ftp.Client();
    client.ftp.verbose = false;
    try {
      await client.access({
        host: 'ftp.bom.gov.au',
      });
      await client.cd('anon/gen/fwo/');
      const promise1 = await client.list(srcFile);
      const promise2 = await client.downloadTo(dstFile, srcFile);
      await Promise.all([promise1, promise2]);

    } catch(err) {
      this.platform.log.debug(this.service.displayName, `downloadFromBoM: ${err}`);
    }
    client.close();
  }

  /**
   * Parse the BoM Forecast file
   */
  async bomXmlToJson(srcFile) {
    try {
      const xmlData = fs.readFileSync(srcFile, 'utf8');

      const options = {
        ignoreAttributes : false,
        attributeNamePrefix : '@_',
        preserveOrder: true,
        textNodeName: '$text',
        transformTagName: (tagName) => tagName.replace(/-/g, '_'),
      };
      const parser = new XMLParser(options);
      const jsonObj = parser.parse(xmlData);

      return jsonObj;

    } catch(err) {
      this.platform.log.debug(this.service.displayName, `bomXmlToJson: ${err}`);
    }

  }

}
