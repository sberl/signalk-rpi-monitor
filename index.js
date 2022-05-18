/*
 *  Copyright 2022 Steve Berl (steveberl@gmail.com)
 * This plugin is a modified version of:
 * https://github.com/nmostovoy/signalk-raspberry-pi-monitoring
 *
 *  which is a modified version of
 * https://github.com/sbender9/signalk-raspberry-pi-temperature
 *
 * So a big thank you to those who built the foundation on which I am
 * adding to.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const debug = require('debug')('signalk-rpi-monitor')
const spawn = require('child_process').spawn

const gpuTempCommand = 'vcgencmd measure_temp'
const cpuTempCommand = 'cat /sys/class/thermal/thermal_zone0/temp'
const cpuUtilMpstatCommand = 'S_TIME_FORMAT=\'ISO\' mpstat -P ALL 5 1 | sed -n 4,8p'
const memUtilCommand = 'free'
const sdUtilCommand = 'df --output=pcent / | tail -1 | awk \'gsub("%","")\''

module.exports = function (app) {
  const plugin = {}
  let timer

  plugin.id = 'signalk-rpi-monitor'
  plugin.name = 'RPI Monitor'
  plugin.description = 'Signal K Node Server Plugin for Raspberry PI monitoring'

  plugin.schema = {
    type: 'object',
    description: 'The user running node server must be in the video group to get GPU temperature',
    properties: {
      path_cpu_temp: {
        title: 'SignalK Path for CPU temperature (K)',
        type: 'string',
        default: 'environment.rpi.cpu.temperature'
      },
      path_gpu_temp: {
        title: 'SignalK Path for GPU temperature (K)',
        type: 'string',
        default: 'environment.rpi.gpu.temperature'
      },
      path_cpu_util: {
        title: 'SignalK Path for CPU utilisation (Please install sysstat for per core monitoring)',
        type: 'string',
        default: 'environment.rpi.cpu.utilisation'
      },
      path_mem_util: {
        title: 'SignalK Path for memory utilisation',
        type: 'string',
        default: 'environment.rpi.memory.utilisation'
      },
      path_sd_util: {
        title: 'SignalK Path for SD card utilisation',
        type: 'string',
        default: 'environment.rpi.sd.utilisation'
      },
      rate: {
        title: 'Sample Rate (in seconds)',
        type: 'number',
        default: 30
      }
    }
  }

  plugin.start = function (options) {
    debug('start')

    // notify server, once, of units metadata
    app.handleMessage(plugin.id, {
        updates: [{
            meta: [{
                    path: options.path_cpu_temp,
                    value: {
                        units: 'K'
                    }
                },
                {
                    path: options.path_gpu_temp,
                    value: {
                        units: 'K'
                    }
                },
                {
                    path: options.path_cpu_util,
                    value: {
                        units: 'ratio'
                    }
                },
                {
                    path: options.path_mem_util,
                    value: {
                        units: 'ratio'
                    }
                },
                {
                    path: options.path_sd_util,
                    value: {
                        units: 'ratio'
                    }
                }
            ]
        }]
    })

    function updateEnv () {
      getGpuTemperature()
      getCpuTemperature()
      getCpuUtil()
      getMemUtil()
      getSdUtil()
    }

    function getGpuTemperature () {
      const gputemp = spawn('sh', ['-c', gpuTempCommand])

      gputemp.stdout.on('data', (data) => {
        debug(`got gpu  ${data}`)
        const gpuTemp = (Number(data.toString().split('=')[1].split('\'')[0]) + 273.15).toFixed(2)
        debug(`gpu temp is ${gpuTemp}`)

        app.handleMessage(plugin.id, {
          updates: [
            {
              values: [{
                path: options.path_gpu_temp,
                value: Number(gpuTemp)
              }]
            }
          ]
        })
      })

      gputemp.on('error', (error) => {
        console.error(error.toString())
      })

      gputemp.on('data', function (data) {
        console.error(data.toString())
      })
    }

    function getCpuTemperature () {
      const cputemp = spawn('sh', ['-c', cpuTempCommand])

      cputemp.stdout.on('data', (data) => {
        debug(`got cpu_local  ${data}`)
        const cpuTemp = (Number(data) / 1000 + 273.15).toFixed(2)
        debug(`cpu temp is ${cpuTemp}`)

        app.handleMessage(plugin.id, {
          updates: [
            {
              values: [{
                path: options.path_cpu_temp,
                value: Number(cpuTemp)
              }]
            }
          ]
        })
      })

      cputemp.on('error', (error) => {
        console.error(error.toString())
      })

      cputemp.stderr.on('data', function (data) {
        console.error(data.toString())
      })
    }

    function getCpuUtil () {
      const cpuutilfull = spawn('sh', ['-c', cpuUtilMpstatCommand])

      cpuutilfull.stdout.on('data', (data) => {
        debug(`got cpu utilisation  ${data}`)
        const re = /all/im
        if (data.toString().match(re)) {
          const cpu_util = data.toString().replace(/(\n|\r)+$/, '').split('\n')
          cpu_util.forEach(function (cpu_util_line) {
            var spl_line = cpu_util_line.replace(/ +/g, ' ').split(' ')
            const re2 = /^[0-9]?$/
            if (spl_line[1].match(re2)) {
              debug(`cpu utilisation core ${spl_line[1]} is ${spl_line[11]}`)
              var pathArray = options.path_cpu_util.toString().split('.')
              var newPath = pathArray[0] + '.'
              for (let i = 1; i < (pathArray.length - 1); i++) {
                newPath = newPath + pathArray[i].toString() + '.'
              }
              newPath = newPath + 'core.' + (Number(spl_line[1]) + 1).toString()
              newPath = newPath + '.' + pathArray[(pathArray.length - 1)]
              const cpu_util_core = ((100 - Number(spl_line[11])) / 100).toFixed(2)
              app.handleMessage(plugin.id, {
                updates: [
                  {
                    values: [{
                      path: newPath,
                      value: Number(cpu_util_core)
                    }]
                  }
                ]
              })
            } else {
              debug(`cpu utilisation is ${spl_line[11]}`)
              const cpu_util_all = ((100 - Number(spl_line[11])) / 100).toFixed(2)
              app.handleMessage(plugin.id, {
                updates: [
                  {
                    values: [{
                      path: options.path_cpu_util,
                      value: Number(cpu_util_all)
                    }]
                  }
                ]
              })
            }
          })
        }
      })

      cpuutilfull.on('error', (error) => {
        console.error(error.toString())
      })

      cpuutilfull.stderr.on('data', function (data) {
        console.error(data.toString())
      })
    }

    function getMemUtil () {
      const memUtil = spawn('sh', ['-c', memUtilCommand])

      memUtil.stdout.on('data', (data) => {
        debug(`got memory  ${data}`)
        const mem_util = data.toString().replace(/(\n|\r)+$/, '').split('\n')
        mem_util.forEach(function (mem_util_line) {
          const splm_line = mem_util_line.replace(/ +/g, ' ').split(' ')
          if (splm_line[0].toString() === 'Mem:') {
            const mem_util_per = (Number(splm_line[2]) / Number(splm_line[1])).toFixed(2)
            app.handleMessage(plugin.id, {
              updates: [
                {
                  values: [{
                    path: options.path_mem_util,
                    value: Number(mem_util_per)
                  }]
                }
              ]
            })
          }
        })
      })

      memUtil.on('error', (error) => {
        console.error(error.toString())
      })

      memUtil.stderr.on('data', function (data) {
        console.error(data.toString())
      })
    }

    function getSdUtil () {
      const sdutil = spawn('sh', ['-c', sdUtilCommand])

      sdutil.stdout.on('data', (data) => {
        debug(`got sd  ${data}`)
        const sd_util = Number(data.toString().replace(/(\n|\r)+$/, '')) / 100
        app.handleMessage(plugin.id, {
          updates: [
            {
              values: [{
                path: options.path_sd_util,
                value: Number(sd_util)
              }]
            }
          ]
        })
      })

      sdutil.on('error', (error) => {
        console.error(error.toString())
      })

      sdutil.stderr.on('data', function (data) {
        console.error(data.toString())
      })
    }

    updateEnv()
    timer = setInterval(updateEnv, options.rate * 1000)
  }

  plugin.stop = function () {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return plugin
}
