import { Component, computed, signal } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { Router } from '@angular/router'
import {
  AlertController,
  IonBackButton,
  IonButton,
  IonButtons,
  IonCard,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone'
import { addIcons } from 'ionicons'
import { Subscription, catchError, EMPTY, switchMap, timer } from 'rxjs'
import { addOutline, arrowBackOutline, lockClosedOutline, refresh, scanOutline, wifiOutline } from 'ionicons/icons'
import { MediaService } from '../media.service'
import { PlayerCmds, PlayerService } from '../player.service'
import { WifiService } from '../wifi.service'
import type { WifiBandChoice, WifiNetwork, WifiStatus } from '../wifi-network'

@Component({
  selector: 'app-wifi',
  templateUrl: './wifi.page.html',
  styleUrls: ['./wifi.page.scss'],
  imports: [
    IonTitle,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonButton,
    IonIcon,
    IonContent,
    IonCard,
    IonList,
    IonItem,
    IonLabel,
    IonSpinner,
  ],
})
export class WifiPage {
  protected network = toSignal(this.mediaService.network$, { initialValue: null })
  // The link as it is right now, asked for every few seconds while the page is open (network.json, which
  // `network` comes from, is only rewritten every 30 seconds)
  private status = signal<WifiStatus | null>(null)
  private statusPolling?: Subscription
  // What the top card shows: the live link, until the first answer the network.json values
  protected card = computed(() => {
    const live = this.status()
    if (!live) {
      const stored = this.network()
      return {
        interface: stored?.interface,
        name: stored?.wifi ?? '—',
        detail: `${stored?.wifilink ?? ''} · ${stored?.wifisignal ?? ''}`,
        ip: stored?.ip ?? '—',
        gateway: stored?.gateway ?? '—',
      }
    }
    const connected = live.state === 'COMPLETED' && live.ssid
    return {
      interface: live.interface,
      name: connected ? live.ssid : 'Connecting …',
      detail: connected
        ? [live.signal !== undefined ? `${live.signal} %` : '', live.signalDbm !== undefined ? `${live.signalDbm} dBm` : '', live.band ? `${live.band} GHz` : '']
            .filter((part) => part !== '')
            .join(' · ')
        : '',
      ip: live.ip ?? '—',
      gateway: live.gateway ?? '—',
    }
  })
  protected networks = signal<WifiNetwork[]>([])
  protected loading = signal(true)
  protected readonly signalBars = [1, 2, 3, 4]

  constructor(
    private mediaService: MediaService,
    private wifiService: WifiService,
    public alertController: AlertController,
    private playerService: PlayerService,
    private router: Router,
  ) {
    addIcons({ refresh, wifiOutline, addOutline, arrowBackOutline, lockClosedOutline, scanOutline })
  }

  ionViewWillEnter() {
    this.loadNetworks()
    this.statusPolling = timer(0, 3000)
      .pipe(switchMap(() => this.wifiService.getStatus().pipe(catchError(() => EMPTY))))
      .subscribe((status) => this.status.set(status))
  }

  ionViewWillLeave() {
    this.statusPolling?.unsubscribe()
  }

  // Scans for networks in range (takes a few seconds) and merges them with the saved ones.
  protected loadNetworks() {
    this.loading.set(true)
    this.wifiService.getNetworks().subscribe({
      next: (networks) => {
        this.networks.set(networks)
        this.loading.set(false)
      },
      error: () => {
        this.loading.set(false)
      },
    })
  }

  // 0-4 lit bars for the signal strength in percent.
  protected signalLevel(network: WifiNetwork): number {
    const signal = network.signal ?? 0
    if (!network.available || signal <= 0) {
      return 0
    }
    return signal >= 75 ? 4 : signal >= 50 ? 3 : signal >= 25 ? 2 : 1
  }

  // "2.4 GHz", "5 GHz" or "2.4 + 5 GHz" (both). For the connected network the band in use is added
  // when the network is available on more than one.
  protected bandText(network: WifiNetwork): string {
    const bands = [...(network.bands ?? [])].sort((x, y) => Number(x) - Number(y))
    if (bands.length === 0) {
      return ''
    }
    const text = `${bands.join(' + ')} GHz`
    return network.current && network.connectedBand && bands.length > 1 ? `${text} (connected on ${network.connectedBand} GHz)` : text
  }

  // The 2.4 / 5 GHz choice is offered for a saved network that is broadcast on both bands. One that is
  // already limited to a band keeps it, so the limit can always be lifted again.
  protected canChooseBand(network: WifiNetwork): boolean {
    if (network.id === undefined) {
      return false
    }
    return (network.bands?.length ?? 0) > 1 || (network.band !== undefined && network.band !== 'auto')
  }

  protected setBand(network: WifiNetwork, band: WifiBandChoice) {
    if (network.id === undefined || (network.band ?? 'auto') === band) {
      return
    }
    // The connection is set up again when this is the network in use: give it about ten seconds
    this.loading.set(true)
    this.wifiService.setNetworkBand(network.id, band).subscribe({
      next: () => setTimeout(() => this.loadNetworks(), network.current ? 10000 : 500),
      error: () => this.loadNetworks(),
    })
  }

  addNetworkButtonPressed() {
    this.router.navigate(['/wifi/add'])
  }

  // A network in range that is not saved yet: add it with the name already filled in.
  connectNetworkButtonPressed(network: WifiNetwork) {
    this.router.navigate(['/wifi/add'], { state: { newNetworkSsid: network.ssid } })
  }

  changeNetworkButtonPressed(network: WifiNetwork) {
    this.router.navigate(['/wifi/add'], { state: { editNetwork: { id: network.id, ssid: network.ssid } } })
  }

  async deleteNetworkButtonPressed(network: WifiNetwork) {
    const alert = await this.alertController.create({
      cssClass: 'alert',
      header: 'Delete network',
      message: `Do you want to remove the saved network "${network.ssid}"?`,
      buttons: [
        {
          text: 'Delete',
          handler: () => {
            this.wifiService.removeNetwork(network.id).subscribe(() => {
              this.loadNetworks()
            })
          },
        },
        {
          text: 'Cancel',
        },
      ],
    })

    await alert.present()
  }

  async wifiRestartButtonPressed() {
    const alert = await this.alertController.create({
      cssClass: 'alert',
      header: 'Restart Wifi',
      message: 'Do you want to restart the wifi network?',
      buttons: [
        {
          text: 'Restart',
          handler: () => {
            this.playerService.sendCmd(PlayerCmds.NETWORKRESTART)
          },
        },
        {
          text: 'Cancel',
        },
      ],
    })

    await alert.present()
  }

  async enableWifiOnButtonPressed() {
    const alert = await this.alertController.create({
      cssClass: 'alert',
      header: 'OnBoard-Wifi',
      message: 'Enable OnBoard-Wifi.',
      buttons: [
        {
          text: 'Enable',
          handler: () => {
            this.playerService.sendCmd(PlayerCmds.ENABLEWIFI)
          },
        },
        {
          text: 'Cancel',
        },
      ],
    })

    await alert.present()
  }
}
