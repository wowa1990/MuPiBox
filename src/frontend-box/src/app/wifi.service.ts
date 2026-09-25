import { HttpClient } from '@angular/common/http'
import { Injectable } from '@angular/core'
import { Observable } from 'rxjs'
import { environment } from '../environments/environment'
import type { WifiBandChoice, WifiConfiguredNetwork, WifiNetwork, WifiStatus } from './wifi-network'

@Injectable({
  providedIn: 'root',
})
export class WifiService {
  constructor(private http: HttpClient) {}

  public getConfiguredNetworks(): Observable<WifiConfiguredNetwork[]> {
    return this.http.get<WifiConfiguredNetwork[]>(`${environment.backend.apiUrl}/wifi/configured`)
  }

  /** The WiFi link as it is right now. */
  public getStatus(): Observable<WifiStatus> {
    return this.http.get<WifiStatus>(`${environment.backend.apiUrl}/wifi/status`)
  }

  /** Networks in range (strongest first) plus saved ones that are out of range. */
  public getNetworks(): Observable<WifiNetwork[]> {
    return this.http.get<WifiNetwork[]>(`${environment.backend.apiUrl}/wifi/networks`)
  }

  public removeNetwork(id: number): Observable<string> {
    return this.http.delete(`${environment.backend.apiUrl}/wifi/configured/${id}`, { responseType: 'text' })
  }

  /** Lets the box use only one band for a saved network, or both again ('auto'). */
  public setNetworkBand(id: number, band: WifiBandChoice): Observable<string> {
    return this.http.post(`${environment.backend.apiUrl}/wifi/configured/${id}/band`, { band }, { responseType: 'text' })
  }

  public updateNetworkPassword(id: number, password: string): Observable<string> {
    return this.http.post(
      `${environment.backend.apiUrl}/wifi/configured/${id}/password`,
      { password },
      { responseType: 'text' },
    )
  }
}
