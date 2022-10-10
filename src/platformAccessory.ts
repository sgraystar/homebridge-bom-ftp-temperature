import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { BoMForecastPlatform } from './platform';
const ftp = require('basic-ftp');
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

    const serviceName1 = accessory.context.device.label + ' Forecast Max';
    const serviceSubtype1 = accessory.context.device.bomproductid + '-max';
    this.service = this.accessory.getService(serviceName1) ||
      this.accessory.addService(this.platform.Service.TemperatureSensor, serviceName1, serviceSubtype1);
    //const serviceName2 = accessory.context.device.label + ' Forecast Min';
    //const serviceSubtype2 = accessory.context.device.bomproductid + '-min';
    //this.service = this.accessory.getService(serviceName2) ||
    //  this.accessory.addService(this.platform.Service.TemperatureSensor, serviceName2, serviceSubtype2);

    // register handlers for the Get Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getTemp.bind(this));               // GET - bind to the `getTemp` method below

    // Add "temperature sensor" services to the accessory
    const temperatureSensorMaxService = this.accessory.getService(serviceName1) ||
      this.accessory.addService(this.platform.Service.TemperatureSensor, serviceName1, serviceSubtype1);
    //const temperatureSensorMinService = this.accessory.getService(serviceName2) ||
    //  this.accessory.addService(this.platform.Service.TemperatureSensor, serviceName2, serviceSubtype2);

    /**
     * Download the BoM forecast file, extract forecast temperatures and the next routine issue time, then schedule ongoing
     * updates to the forecast temperature
     */
    const remoteFile = this.accessory.context.device.bomproductid + '.xml';
    const downloadDelay = this.accessory.context.device.downloaddelay;
    this.scheduleUpdates(remoteFile, downloadDelay, temperatureSensorMaxService);
    //this.scheduleUpdates(remoteFile, temperatureSensorMaxService, temperatureSensorMinService);
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
    if (cacheTemp == null) {
      cacheTemp = -270;
    }
    this.platform.log.debug('Get Characteristic CurrentTemperature ->', cacheTemp);

    return cacheTemp;
  }

  /**
   * Updating characteristics values asynchronously.
   *
   * Here we change update the temperature sensor current temperature every 10 seconds using
   * the `updateCharacteristic` method.
   *
   */
  async scheduleUpdates(remoteFile, downloadDelay, temperatureSensorMaxService) {
    try {
      // Download the BoM file
      const localFile = (os.tmpdir() + '\\' + remoteFile);
      await this.downloadFromBoM(localFile, remoteFile);

      // Parse the xml file for temperatures & next issue time
      const bomJson = await this.bomXmlToJson(localFile);
      //this.platform.log.debug(JSON.stringify(bomJson, null, 2));

      // Extract forecast maximum temperature and push the new forecast temperature value to HomeKit
      try {
        const air_temperature_maximum = bomJson[1].product[1].forecast[2].area[0]['forecast-period'][1].element[0]['#text'];

        const maxTemp = Number(air_temperature_maximum);
        temperatureSensorMaxService.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, maxTemp);
        this.platform.log.debug('New temperature', this.service.displayName, maxTemp);

      // air_temperature_maximum for today is not always present in the file
      } catch (error) {
        this.platform.log.debug('forecast max not found for today', this.service.displayName);

      } finally {
        // Extract the next routine issue time
        const nextIssueTime = bomJson[1].product[0].amoc[8]['next-routine-issue-time-utc'][0]['#text'];

        const downloadOffset = downloadDelay * 60 * 1000;
        const d1ms = new Date().getTime();
        const d2ms = new Date(nextIssueTime).getTime();
        const nextDownload = d2ms - d1ms + downloadOffset;
        this.platform.log.debug('nextDownload =', nextDownload);

        if (temperatureSensorMaxService !== undefined) {
          setTimeout(() => {
            this.scheduleUpdates(remoteFile, downloadDelay, temperatureSensorMaxService);
          }, nextDownload );
        }
      }

    // Download or parse failed, maybe invalid arguments, maybe temporary, try again in 1 hour
    } catch (error) {
      this.platform.log.debug('error:', error);
      const nextDownload = 60 * 60 * 1000;
      this.platform.log.debug('nextDownload =', nextDownload);

      if (temperatureSensorMaxService !== undefined) {
        setTimeout(() => {
          this.scheduleUpdates(remoteFile, downloadDelay, temperatureSensorMaxService);
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
      this.platform.log.debug('error: ' + err);
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
      };
      const parser = new XMLParser(options);
      const jsonObj = parser.parse(xmlData);

      return jsonObj;

    } catch(err) {
      this.platform.log.debug('error: ' + err);
    }

  }

}
