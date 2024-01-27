import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { BoMForecastPlatform } from './platform';
import ftp = require('basic-ftp');
import { XMLParser } from 'fast-xml-parser';
import os from 'node:os';
import * as fs from 'node:fs';
import path = require('path');

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

    const serviceName1 = accessory.context.device.label + ' max';
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
      // const localFile = (os.tmpdir() + '\\' + remoteFile);
      const localFile = path.join(os.tmpdir(), remoteFile);
      this.platform.log.debug(this.service.displayName, 'temp BoM file =', localFile);

      await this.downloadFromBoM(localFile, remoteFile);

      // Parse the xml file
      const bomJson = await this.bomXmlToJson(localFile);
      //this.platform.log.debug('bomJson\n', JSON.stringify(bomJson, null, 2));

      /**
       * Extract the next routine issue time and schedule the next download
       */
      const nextRoutineIssueTimeUTC = bomJson[1].product[0].amoc[8].next_routine_issue_time_utc[0].$text;
      this.platform.log.debug(this.service.displayName, 'times\n', JSON.stringify(bomJson[1].product[0], null, 2));

      const downloadOffset = delayMinutes * 60 * 1000;
      const d1ms = new Date().getTime();
      const d2ms = new Date(nextRoutineIssueTimeUTC).getTime();
      const nextDownload = d2ms - d1ms + downloadOffset;
      this.platform.log.debug(this.service.displayName, 'nextDownload =', nextDownload);

      if (temperatureSensorMaxService !== undefined) {
        setTimeout(() => {
          this.scheduleUpdates(remoteFile, delayMinutes, temperatureSensorMaxService);
        }, nextDownload );
      }

      /**
       * Extract the forecast maximum temperature and push the new forecast temperature value to HomeKit
       */
      const bomJsonForecast = bomJson[1].product[1].forecast;
      this.platform.log.debug(this.service.displayName, 'forecasts\n', JSON.stringify(bomJsonForecast, null, 2));

      const searchLocation = await this.extractLocation(bomJsonForecast, this.accessory.context.device.label);

      const newTemp = await this.extractMaxTemp(searchLocation);
      if (newTemp !== '') {
        temperatureSensorMaxService.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, Number(newTemp));
        this.platform.log.info(this.service.displayName, 'changed temperature to', newTemp);
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

  /**
   * Search for a forecast with the named Location
   */
  async extractLocation(jsonObj, searchTarget) {
    let result = jsonObj;

    // Convert searchstring to title case to compare with BoM locations
    const tempString = searchTarget.toLowerCase().trim().replace(/\s+/g, ' ').split(' ');
    for (let i = 0; i < tempString.length; i++) {
      tempString[i] = tempString[i].charAt(0).toUpperCase() + tempString[i].slice(1);
    }
    const searchString = tempString.join(' ');
    this.platform.log.debug(this.service.displayName, 'searching for', searchString);

    for (const key1 in jsonObj) {
      if (jsonObj[key1] === searchString) {
        this.platform.log.debug(this.service.displayName, searchString, [key1]);
      }
      for (const key2 in jsonObj[key1]) {
        if (jsonObj[key1][key2] === searchString) {
          this.platform.log.debug(this.service.displayName, searchString, [key1], [key2]);
        }
        for (const key3 in jsonObj[key1][key2]) {
          if (jsonObj[key1][key2][key3] === searchString && jsonObj[key1][key2]['@_type'] === 'location') {
            this.platform.log.debug(this.service.displayName, searchString, [key1], [key2], [key3]);
            result = jsonObj[key1];
            return result;
          }
          for (const key4 in jsonObj[key1][key2][key3]) {
            if (jsonObj[key1][key2][key3][key4] === searchString) {
              this.platform.log.debug(this.service.displayName, searchString, [key1], [key2], [key3], [key4]);
            }
            for (const key5 in jsonObj[key1][key2][key3][key4]) {
              if (jsonObj[key1][key2][key3][key4][key5] === searchString) {
                this.platform.log.debug(this.service.displayName, searchString, [key1], [key2], [key3], [key4], [key5]);
              }
              for (const key6 in jsonObj[key1][key2][key3][key4][key5]) {
                if (jsonObj[key1][key2][key3][key4][key5][key6] === searchString) {
                  this.platform.log.debug(this.service.displayName, searchString, [key1], [key2], [key3], [key4], [key5], [key6]);
                }
                for (const key7 in jsonObj[key1][key2][key3][key4][key5][key6]) {
                  if (jsonObj[key1][key2][key3][key4][key5][key6][key7] === searchString) {
                    this.platform.log.debug(this.service.displayName, searchString, [key1], [key2], [key3], [key4], [key5], [key6], [key7]);
                  }
                }
              }
            }
          }
        }
      }
    }
    return result;
  }

  /**
   * Extract the first air_temperature_maximum from the forecast and check it is for today
   */
  async extractMaxTemp(jsonObj): Promise<string> {
    let result = '';
    for (const key1 in jsonObj) {
      for (const key2 in jsonObj[key1]) {
        for (const key3 in jsonObj[key1][key2]) {
          for (const key4 in jsonObj[key1][key2][key3]) {
            for (const key5 in jsonObj[key1][key2][key3][key4]) {
              for (const key6 in jsonObj[key1][key2][key3][key4][key5]) {
                if (jsonObj[key1][key2][key3][key4][key5][key6] === 'air_temperature_maximum') {
                  const day0 = 0;
                  const day = Number([key2]);
                  this.platform.log.debug(this.service.displayName, 'path', [key1], [key2], [key3], [key4], [key5], [key6]);
                  // Only return the forecast maximum temperature if it is for today
                  if (day === day0) {
                    result = jsonObj[key1][key2][key3][key4].element[0].$text;
                  }
                  return result;
                }
                for (const key7 in jsonObj[key1][key2][key3][key4][key5][key6]) {
                  if (jsonObj[key1][key2][key3][key4][key5][key6][key7] === 'air_temperature_maximum') {
                    const day0 = 0;
                    const day = Number([key3]);
                    this.platform.log.debug(this.service.displayName, 'path', [key1], [key2], [key3], [key4], [key5], [key6], [key7]);
                    // Only return the forecast maximum temperature if it is for today
                    if (day === day0) {
                      result = jsonObj[key1][key2][key3][key4][key5].element[0].$text;
                    }
                    return result;
                  }
                }
              }
            }
          }
        }
      }
    }
    return result;
  }

  /**
   * Helper function, search the JSON tree for a given string
   */
  async extractString(jsonObj, searchTarget) {
    const searchString = searchTarget;
    for (const key1 in jsonObj) {
      if (jsonObj[key1] === searchString) {
        this.platform.log.debug(this.service.displayName, searchString, [key1]);
      }
      for (const key2 in jsonObj[key1]) {
        if (jsonObj[key1][key2] === searchString) {
          this.platform.log.debug(this.service.displayName, searchString, [key1], [key2]);
        }
        for (const key3 in jsonObj[key1][key2]) {
          if (jsonObj[key1][key2][key3] === searchString) {
            this.platform.log.debug(this.service.displayName, searchString, [key1], [key2], [key3]);
          }
          for (const key4 in jsonObj[key1][key2][key3]) {
            if (jsonObj[key1][key2][key3][key4] === searchString) {
              this.platform.log.debug(this.service.displayName, searchString, [key1], [key2], [key3], [key4]);
            }
            for (const key5 in jsonObj[key1][key2][key3][key4]) {
              if (jsonObj[key1][key2][key3][key4][key5] === searchString) {
                this.platform.log.debug(this.service.displayName, searchString, [key1], [key2], [key3], [key4], [key5]);
              }
              for (const key6 in jsonObj[key1][key2][key3][key4][key5]) {
                if (jsonObj[key1][key2][key3][key4][key5][key6] === searchString) {
                  this.platform.log.debug(this.service.displayName, searchString, [key1], [key2], [key3], [key4], [key5], [key6]);
                }
                for (const key7 in jsonObj[key1][key2][key3][key4][key5][key6]) {
                  if (jsonObj[key1][key2][key3][key4][key5][key6][key7] === searchString) {
                    this.platform.log.debug(this.service.displayName, searchString, [key1], [key2], [key3], [key4], [key5], [key6], [key7]);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

}
